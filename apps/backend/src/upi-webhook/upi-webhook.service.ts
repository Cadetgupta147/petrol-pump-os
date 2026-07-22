import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ShiftSalesService } from '../shift-sales/shift-sales.service';
import { runInTenantContext } from '../common/tenant-context';
import { verifyWebhookSignature } from './verify-webhook-signature.util';

// Section 8A.3 — PhonePe/Paytm Business merchant webhook handler. This is
// the security-sensitive, money-touching part of Section 8A (CLAUDE.md:
// human review flag before merge) — signature verification and idempotency
// both have to be right, since this endpoint is @Public() (no staff JWT) and
// directly increments a money figure.
//
// PAYLOAD SHAPE NOTE (open decision — provider not yet chosen, see
// CLAUDE.md/Section 17): the exact field names below (`providerEventId`,
// `amount`, `receivedAt`, `nozzleId`, `provider`) are a reasonable
// provider-agnostic guess, not a real PhonePe/Paytm schema. Whichever
// provider is chosen will need this mapped to their actual webhook body
// shape — this is the one place that needs to change, alongside
// verify-webhook-signature.util.ts.
type RawUpiWebhookPayload = {
  provider?: string;
  providerEventId?: string;
  amount?: number | string;
  receivedAt?: string;
  nozzleId?: string;
};

@Injectable()
export class UpiWebhookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly shiftSalesService: ShiftSalesService,
  ) {}

  async handleWebhook(
    pumpId: string,
    rawBody: Buffer | undefined,
    signatureHeader: string | undefined,
    payload: RawUpiWebhookPayload,
  ) {
    // --- Signature verification FIRST, before touching the DB at all. ---
    const secret = this.config.get<string>('UPI_WEBHOOK_SIGNING_SECRET');
    if (!verifyWebhookSignature(rawBody, signatureHeader, secret)) {
      throw new UnauthorizedException('Invalid or missing webhook signature');
    }

    // Multi-tenancy Phase 3: pumpId comes from the URL path (no JWT on this
    // route — see the controller's comment). Pump is deliberately NOT a
    // tenant-scoped model (see tenant-scoping.extension.ts), so this lookup
    // is a plain, unscoped existence check — the one place it's safe/correct
    // for that to be unscoped, since it's what ESTABLISHES the tenant for
    // everything that follows.
    const pump = await this.prisma.pump.findUnique({ where: { id: pumpId } });
    if (!pump || !pump.active) {
      throw new NotFoundException('Unknown pump');
    }

    // --- Minimal payload shape validation (not a class-validator DTO on
    // purpose — see the controller's comment on why this route accepts an
    // untyped body). ---
    const providerEventId = payload?.providerEventId;
    if (!providerEventId || typeof providerEventId !== 'string') {
      throw new BadRequestException(
        'Missing providerEventId in webhook payload',
      );
    }
    const amount = Number(payload?.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Missing or invalid amount in webhook payload');
    }
    const provider =
      payload?.provider ??
      this.config.get<string>('UPI_MERCHANT_PROVIDER') ??
      'unknown';
    const receivedAt = payload?.receivedAt
      ? new Date(payload.receivedAt)
      : new Date();
    const nozzleId = payload?.nozzleId ?? null;

    // --- Idempotency + matching + increment, all in one transaction. ---
    // Create-then-catch-P2002 (not find-then-create) so two concurrent
    // deliveries of the same providerEventId can never both "win" a
    // find-missing check and double-insert — the DB's unique constraint on
    // UpiWebhookEvent.providerEventId is the actual race-proof guard.
    //
    // The whole transaction runs inside runInTenantContext so
    // tenant-scoping.extension.ts auto-scopes/auto-stamps pumpId on every
    // tenant-scoped table it touches (UpiWebhookEvent, MeterReading,
    // ShiftSalesSummary) exactly as it would for a normal JWT-authenticated
    // request — see tenant-context.ts's comment on why the callback must be
    // async and internally await (a bare arrow silently loses context here).
    try {
      const result = await runInTenantContext({ pumpId }, async () => {
        return this.prisma.$transaction(async (tx) => {
          const event = await tx.upiWebhookEvent.create({
            data: {
              pumpId,
              provider,
              providerEventId,
              amount,
              receivedAt,
              rawPayload: payload as Prisma.InputJsonValue,
            },
          });

          const matchedShift = await this.findMatchingShift(
            tx,
            receivedAt,
            nozzleId,
          );

          if (matchedShift) {
            await tx.upiWebhookEvent.update({
              where: { id: event.id },
              data: {
                matchedShiftId: matchedShift.id,
                matchedNozzleId: matchedShift.nozzleId,
              },
            });
            // Fallback documented on incrementUpiForShift(): if no
            // ShiftSalesSummary row exists yet for this shift, this is a
            // deliberate no-op (event stays recorded with matchedShiftId
            // set, for later reconciliation) rather than an error.
            await this.shiftSalesService.incrementUpiForShift(
              tx,
              matchedShift.id,
              amount,
            );
          }

          return {
            eventId: event.id,
            matchedShiftId: matchedShift?.id ?? null,
          };
        });
      });

      return { status: 'processed', ...result };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        // Duplicate delivery (same providerEventId already processed) —
        // no-op. Still respond as a success so the provider doesn't
        // retry-storm a legitimately-duplicate delivery (per CLAUDE.md /
        // Section 8A.3's idempotency requirement).
        return { status: 'duplicate', providerEventId };
      }
      throw error;
    }
  }

  // Section 8A.3 matching rule: the currently-open (or open-at-the-time)
  // MeterReading "shift" whose window contains receivedAt.
  //   - If the payload identifies a nozzle, match against that specific
  //     nozzle's shift.
  //   - Otherwise, match against whichever shift(s) were open at that
  //     timestamp; if that's ambiguous (zero or more than one candidate),
  //     deliberately leave it unmatched rather than guess — a wrong
  //     auto-match on money is worse than an unmatched event waiting for
  //     manual reconciliation.
  private async findMatchingShift(
    tx: Prisma.TransactionClient,
    receivedAt: Date,
    nozzleId: string | null,
  ) {
    const windowFilter = {
      shiftStart: { lte: receivedAt },
      OR: [{ shiftEnd: null }, { shiftEnd: { gte: receivedAt } }],
    };

    if (nozzleId) {
      return tx.meterReading.findFirst({
        where: { ...windowFilter, nozzleId },
        orderBy: { shiftStart: 'desc' },
      });
    }

    const candidates = await tx.meterReading.findMany({
      where: windowFilter,
      orderBy: { shiftStart: 'desc' },
    });
    return candidates.length === 1 ? candidates[0] : null;
  }
}
