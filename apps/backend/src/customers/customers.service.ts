import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as QRCode from 'qrcode';
import { PrismaService } from '../prisma/prisma.service';
import { requireTenantContext } from '../common/tenant-context';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { SetLoyaltyRateOverrideDto } from './dto/set-loyalty-rate-override.dto';
import { RecordConsentDto } from './dto/record-consent.dto';
import { CreateOpeningBalanceDto } from './dto/create-opening-balance.dto';
import { AuthenticatedUser } from '../auth/types/jwt-payload.interface';
import { allocateQrMemberId, isValidQrMemberId } from './member-id';
import {
  computeOutstandingSlices,
  OutstandingLedgerEvent,
} from './outstanding-statement.util';
// Section 3.4/6.1 — a phone typed here (dealer-created customer, web portal)
// must land in the DB in the EXACT same canonical form
// CustomerAuthService.verifyOtp's `findUnique({ where: { phone } })` expects
// (Section 5's OTP login), or a real customer can never log into the
// Credit Customer App with the number printed on their own KYC record.
// normalizeIndianMobile is the single source of truth for that canonical
// form — reused here rather than re-implemented, so the two call sites can
// never drift apart.
import { normalizeIndianMobile } from '../customer-auth/phone.util';

// Section 17.24 — ID-document capture, optional/dealer's-discretion.
// idDocumentType/idDocumentNumber must both be present or both absent —
// "Aadhaar" with no number, or a bare number with no type, is meaningless
// data. Takes the RESULTING value each field would have after the write
// (not the raw DTO), so it works identically for create() (existing values
// are always undefined) and update() (existing values fill in whichever
// side the caller didn't touch) — see both call sites.
export function assertIdDocumentPairConsistent(
  type: string | null | undefined,
  number: string | null | undefined,
): void {
  const hasType = type !== null && type !== undefined && type !== '';
  const hasNumber = number !== null && number !== undefined && number !== '';
  if (hasType !== hasNumber) {
    throw new BadRequestException(
      'idDocumentType and idDocumentNumber must both be set, or both left empty',
    );
  }
}

// Customer master CRUD + ledger — Section 3.4. Outstanding balance is
// deliberately NOT stored on Customer: it's derived on read from the
// bill/payment ledger (see ledger() below). Auth/role guards do exist and
// apply here: the global JwtAuthGuard (app.module.ts) requires a valid JWT
// on every route, and CustomersController carries
// @Roles(Role.OWNER, Role.ACCOUNTANT), enforced by the global RolesGuard.
@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateCustomerDto) {
    // Member id allocation + customer create share one transaction so a
    // failed create (e.g. duplicate phone at this pump) rolls the counter
    // increment back — no burned sequence numbers (Section 6.1/6.7, see
    // member-id.ts).
    //
    // Phase 0.2 — every Customer created here gets a linked CustomerAccount
    // (find-or-create by phone): if this phone already has an account (e.g.
    // a customer who's a member elsewhere, once multiple pumps exist), the
    // existing account is reused so the same phone/OTP-login serves every
    // pump membership; otherwise a new account is created. A second
    // create() for the same phone AT THIS SAME PUMP still fails (P2002 on
    // Customer's @@unique([accountId, pumpId])), preserving today's
    // "customer already exists" behavior.
    //
    // Phase 0.3 — pumpId is now required on Customer's Prisma input type,
    // so it's stamped explicitly below (the extension would also inject it
    // at runtime for this top-level create, but TypeScript can't see
    // that). allocateQrMemberId() needs pumpId passed explicitly too,
    // since Pump/MemberIdCounter lookups aren't tenant-scoped the same way
    // (Pump IS the tenant root).
    assertIdDocumentPairConsistent(dto.idDocumentType, dto.idDocumentNumber);

    const { pumpId } = requireTenantContext();
    return this.prisma
      .$transaction(async (tx) => {
        const normalizedPhone = normalizeIndianMobile(dto.phone);
        const account = await tx.customerAccount.upsert({
          where: { phone: normalizedPhone },
          update: {},
          create: { phone: normalizedPhone, name: dto.name },
        });
        const qrMemberId = await allocateQrMemberId(tx, pumpId);
        return tx.customer.create({
          data: {
            pumpId,
            accountId: account.id,
            name: dto.name,
            phone: normalizedPhone,
            vehicleNumber: dto.vehicleNumber,
            companyName: dto.companyName,
            creditLimit: dto.creditLimit ?? 0,
            qrMemberId,
            idDocumentType: dto.idDocumentType,
            idDocumentNumber: dto.idDocumentNumber,
          },
        });
      })
      .catch((error) => this.handlePrismaError(error));
  }

  findAll() {
    return this.prisma.customer.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) {
      throw new NotFoundException(`Customer ${id} not found`);
    }
    return customer;
  }

  async update(id: string, dto: UpdateCustomerDto) {
    // Confirm existence first so a bad id always yields a clean 404, not a
    // Prisma P2025 translated into a generic error.
    const existing = await this.findOne(id);

    assertIdDocumentPairConsistent(
      dto.idDocumentType !== undefined ? dto.idDocumentType : existing.idDocumentType,
      dto.idDocumentNumber !== undefined ? dto.idDocumentNumber : existing.idDocumentNumber,
    );

    // Phase 0.2 — if this update sets/changes phone (e.g. the informal ->
    // verified upgrade path, Section 3.4A, adding a phone for the first
    // time), find-or-create the matching CustomerAccount and link it, same
    // as create(). A membership that already had a different account linked
    // (phone changed to a different number) gets re-linked to the new one.
    return this.prisma
      .$transaction(async (tx) => {
        let accountId = existing.accountId;
        let normalizedPhone: string | undefined;
        if (dto.phone !== undefined) {
          normalizedPhone = normalizeIndianMobile(dto.phone);
          const account = await tx.customerAccount.upsert({
            where: { phone: normalizedPhone },
            update: {},
            create: { phone: normalizedPhone, name: dto.name ?? existing.name },
          });
          accountId = account.id;
        }

        return tx.customer.update({
          where: { id },
          data: {
            ...(dto.name !== undefined && { name: dto.name }),
            ...(normalizedPhone !== undefined && { phone: normalizedPhone, accountId }),
            ...(dto.vehicleNumber !== undefined && {
              vehicleNumber: dto.vehicleNumber,
            }),
            ...(dto.companyName !== undefined && {
              companyName: dto.companyName,
            }),
            ...(dto.creditLimit !== undefined && {
              creditLimit: dto.creditLimit,
            }),
            ...(dto.idDocumentType !== undefined && {
              idDocumentType: dto.idDocumentType,
            }),
            ...(dto.idDocumentNumber !== undefined && {
              idDocumentNumber: dto.idDocumentNumber,
            }),
            // Section 3.4A — the "upgrade informal -> verified" path.
            ...(dto.verificationStatus !== undefined && {
              verificationStatus: dto.verificationStatus,
            }),
          },
        });
      })
      .catch((error) => this.handlePrismaError(error));
  }

  // Section 6.3 step 2/3 — resolve a scanned (or hand-typed) member ID back
  // to the customer, for the DSM app's New Bill auto-fill. Two deliberate
  // narrowings vs. findOne():
  //   1. The Luhn check digit is validated BEFORE any DB lookup — this is
  //      exactly the manual-fallback-entry case isValidQrMemberId() exists
  //      for (Section 6.1's checksum): a mistyped ID fails fast with a 400
  //      the DSM can act on ("re-check the card"), instead of a misleading
  //      404.
  //   2. The response is a minimal auto-fill projection, NOT the full
  //      Customer record: no phone, no creditLimit, no loyaltyRateOverride,
  //      no points. The QR is a pointer, not a wallet (Section 6.1), and the
  //      DSM role gets only what the bill-entry screen needs (Section 6.2:
  //      "The DSM never sees or picks a rate — the system looks it up
  //      silently").
  // NOTE: Customer has no soft-delete (no deletedAt column in the schema) —
  // there is nothing to exclude here. If customer soft-delete is ever added,
  // this lookup must filter it.
  async findByMemberId(qrMemberId: string) {
    if (!isValidQrMemberId(qrMemberId)) {
      throw new BadRequestException(
        `"${qrMemberId}" is not a valid member ID — expected e.g. PUMP001-CUST-04521-6 (check the last digit if typed by hand)`,
      );
    }

    const customer = await this.prisma.customer.findUnique({
      where: { qrMemberId },
    });
    if (!customer) {
      throw new NotFoundException(
        `No customer found for member ID ${qrMemberId}`,
      );
    }

    return {
      customerId: customer.id,
      qrMemberId: customer.qrMemberId,
      name: customer.name,
      vehicleNumber: customer.vehicleNumber,
      // INFORMAL vs VERIFIED — the bill screen shows this so the DSM knows a
      // quick-added customer hasn't been through real onboarding yet
      // (Section 3.4A). It's a visibility flag, never itself a blocker.
      verificationStatus: customer.verificationStatus,
    };
  }

  // Section 6.1 — the QR card payload. The QR encodes ONLY qrMemberId (a
  // pointer, not a wallet): no name, no phone, no points balance, no rate.
  // Everything else is looked up server-side when the QR is scanned, so
  // rate/balance changes never require reprinting a card, and a QR scanned
  // outside this system resolves to nothing.
  async qrCard(id: string) {
    const customer = await this.findOne(id);
    const payload = customer.qrMemberId;

    const [pngDataUrl, svg] = await Promise.all([
      // PNG data URL for on-screen display in the web portal.
      QRCode.toDataURL(payload, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 512,
      }),
      // SVG for print — Section 6.7's laminated PVC card wants a
      // resolution-independent source.
      QRCode.toString(payload, {
        type: 'svg',
        errorCorrectionLevel: 'M',
        margin: 2,
      }),
    ]);

    return {
      customerId: customer.id,
      qrMemberId: payload,
      // Name + vehicle are returned for the printed card's human-readable
      // caption (Section 14's card mockup) — they are NOT inside the QR.
      name: customer.name,
      vehicleNumber: customer.vehicleNumber,
      pngDataUrl,
      svg,
    };
  }

  // Section 6.2 — per-customer earning rate override (rate precedence step
  // 1). null clears the override; 0 is a real override meaning "earns
  // nothing". Owner-only at the controller.
  async setLoyaltyRateOverride(id: string, dto: SetLoyaltyRateOverrideDto) {
    await this.findOne(id);
    return this.prisma.customer.update({
      where: { id },
      data: { loyaltyRateOverride: dto.loyaltyRateOverride },
    });
  }

  // Section 3.4 — full ledger per customer: every bill, every payment,
  // running balance. Works identically for informal and verified customers
  // (no special-casing) and naturally reflects bills created via quick-add
  // in the same request cycle, since it queries by customerId fresh rather
  // than relying on any pre-fetched/cached customer or bill list.
  async ledger(id: string) {
    const customer = await this.findOne(id);

    const [bills, payments, openingBalances] = await Promise.all([
      this.prisma.bill.findMany({
        where: { customerId: id, deletedAt: null },
        include: { paymentLines: true },
        orderBy: { timestamp: 'asc' },
      }),
      this.prisma.payment.findMany({
        where: { customerId: id },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.customerOpeningBalance.findMany({
        where: { customerId: id },
        orderBy: { effectiveAt: 'asc' },
      }),
    ]);

    type LedgerEntry = {
      type: 'BILL' | 'PAYMENT' | 'OPENING_BALANCE';
      id: string;
      timestamp: Date;
      netCreditImpact: number;
      runningBalance: number;
      data: unknown;
    };

    const billEntries: LedgerEntry[] = bills.map((bill) => {
      const creditIn = bill.paymentLines
        .filter((line) => line.paymentType === 'CREDIT' && line.direction === 'IN')
        .reduce((total, line) => total + line.amount, 0);
      const creditOut = bill.paymentLines
        .filter((line) => line.paymentType === 'CREDIT' && line.direction === 'OUT')
        .reduce((total, line) => total + line.amount, 0);
      return {
        type: 'BILL',
        id: bill.id,
        timestamp: bill.timestamp,
        netCreditImpact: creditIn - creditOut,
        runningBalance: 0, // filled in below during the chronological walk
        data: bill,
      };
    });

    const paymentEntries: LedgerEntry[] = payments.map((payment) => ({
      type: 'PAYMENT',
      id: payment.id,
      timestamp: payment.createdAt,
      netCreditImpact: -payment.amount,
      runningBalance: 0,
      data: payment,
    }));

    const openingBalanceEntries: LedgerEntry[] = openingBalances.map((ob) => ({
      type: 'OPENING_BALANCE',
      id: ob.id,
      timestamp: ob.effectiveAt,
      netCreditImpact: ob.amount,
      runningBalance: 0,
      data: ob,
    }));

    const merged = [...billEntries, ...paymentEntries, ...openingBalanceEntries].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
    );

    let runningBalance = 0;
    for (const entry of merged) {
      runningBalance += entry.netCreditImpact;
      entry.runningBalance = runningBalance;
    }

    return {
      customer,
      entries: merged,
      outstandingBalance: runningBalance,
      creditLimit: customer.creditLimit,
    };
  }

  // Section 5B — Credit Customer Outstanding Statement (printable, on
  // letterhead). Reuses the exact same three queries as ledger() above, but
  // runs them through computeOutstandingSlices() (FIFO allocation that keeps
  // bill/opening-balance identity, see outstanding-statement.util.ts) instead
  // of a running balance — a settlement-time document needs to say WHICH
  // bills are still open (vehicle/litres/rate per line), not just the net
  // total owed.
  async outstandingStatement(id: string, asOf: Date = new Date()) {
    const customer = await this.findOne(id);

    const [bills, payments, openingBalances] = await Promise.all([
      this.prisma.bill.findMany({
        where: { customerId: id, deletedAt: null },
        include: { paymentLines: true },
        orderBy: { timestamp: 'asc' },
      }),
      this.prisma.payment.findMany({
        where: { customerId: id },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.customerOpeningBalance.findMany({
        where: { customerId: id },
        orderBy: { effectiveAt: 'asc' },
      }),
    ]);

    const billById = new Map(bills.map((bill) => [bill.id, bill]));
    const openingBalanceById = new Map(openingBalances.map((ob) => [ob.id, ob]));

    const events: OutstandingLedgerEvent[] = [
      ...bills.map((bill) => {
        const creditIn = bill.paymentLines
          .filter((line) => line.paymentType === 'CREDIT' && line.direction === 'IN')
          .reduce((total, line) => total + line.amount, 0);
        const creditOut = bill.paymentLines
          .filter((line) => line.paymentType === 'CREDIT' && line.direction === 'OUT')
          .reduce((total, line) => total + line.amount, 0);
        const netCreditImpact = creditIn - creditOut;
        return {
          timestamp: bill.timestamp,
          netCreditImpact,
          source:
            netCreditImpact > 0
              ? ({ kind: 'BILL', id: bill.id } as const)
              : undefined,
        };
      }),
      ...openingBalances.map((ob) => ({
        timestamp: ob.effectiveAt,
        netCreditImpact: ob.amount,
        source:
          ob.amount > 0 ? ({ kind: 'OPENING_BALANCE', id: ob.id } as const) : undefined,
      })),
      ...payments.map((payment) => ({
        timestamp: payment.createdAt,
        netCreditImpact: -payment.amount,
      })),
    ];

    const slices = computeOutstandingSlices(events);

    // Oldest-first, same read order as the aging report — the top of the
    // statement is "owing since" the longest.
    const lines = slices.map((slice) => {
      if (slice.source.kind === 'BILL') {
        const bill = billById.get(slice.source.id);
        if (!bill) {
          throw new Error(
            `outstandingStatement: slice referenced bill ${slice.source.id} that wasn't loaded`,
          );
        }
        return {
          type: 'BILL' as const,
          billId: bill.id,
          timestamp: bill.timestamp,
          vehicleNumber: bill.vehicleNumber,
          customerNameOnBill: bill.customerName,
          productType: bill.productType,
          litres: bill.litres,
          rateApplied: bill.rateApplied,
          billAmount: bill.amount,
          outstandingAmount: slice.remainingAmount,
        };
      }
      const ob = openingBalanceById.get(slice.source.id);
      if (!ob) {
        throw new Error(
          `outstandingStatement: slice referenced opening balance ${slice.source.id} that wasn't loaded`,
        );
      }
      return {
        type: 'OPENING_BALANCE' as const,
        openingBalanceId: ob.id,
        timestamp: ob.effectiveAt,
        note: ob.note,
        amount: ob.amount,
        outstandingAmount: slice.remainingAmount,
      };
    });

    const totalOutstanding = lines.reduce((total, line) => total + line.outstandingAmount, 0);

    return { customer, asOf, lines, totalOutstanding };
  }

  // Section 3.4 — onboarding an existing (pre-system) credit customer with a
  // real balance from before this pump used the software. Rejects amount ===
  // 0 (class-validator can't express "non-zero" on its own — see the DTO
  // comment); anything else, positive or negative, is accepted as a new
  // audit-trail row rather than editing/deleting a prior entry.
  async addOpeningBalance(
    id: string,
    dto: CreateOpeningBalanceDto,
    user: AuthenticatedUser,
  ) {
    await this.findOne(id);
    if (dto.amount === 0) {
      throw new BadRequestException(
        'Opening balance amount must be non-zero — omit it entirely if there is no prior due',
      );
    }

    return this.prisma.customerOpeningBalance.create({
      data: {
        pumpId: requireTenantContext().pumpId,
        customerId: id,
        amount: dto.amount,
        note: dto.note,
        effectiveAt: dto.effectiveAt ? new Date(dto.effectiveAt) : new Date(),
        recordedById: user.staffId,
      },
    });
  }

  async listOpeningBalances(id: string) {
    await this.findOne(id);
    return this.prisma.customerOpeningBalance.findMany({
      where: { customerId: id },
      orderBy: { effectiveAt: 'asc' },
    });
  }

  // Section 17.11 — DPDP Act compliance scaffolding (go-live blocker,
  // Section 18.1). TECHNICAL scaffolding only: this records THAT consent
  // was captured and against which policy version, not a legal opinion on
  // whether that policy text is itself DPDP-compliant.
  async recordConsent(id: string, dto: RecordConsentDto) {
    await this.findOne(id);
    return this.prisma.customer.update({
      where: { id },
      data: { dataConsentAt: new Date(), dataConsentVersion: dto.version },
    });
  }

  // Section 17.11 — right to access. Gathers every piece of personal data
  // this pump holds about the customer into one JSON payload: profile,
  // bills, loyalty/redemption transactions, payments. Deliberately reuses
  // the same three queries ledger() already runs rather than introducing a
  // second, subtly different definition of "this customer's data".
  async exportData(id: string) {
    const customer = await this.findOne(id);
    const [bills, loyaltyTransactions, redemptionTransactions, payments] =
      await Promise.all([
        this.prisma.bill.findMany({ where: { customerId: id } }),
        this.prisma.loyaltyTransaction.findMany({ where: { customerId: id } }),
        this.prisma.redemptionTransaction.findMany({ where: { customerId: id } }),
        this.prisma.payment.findMany({ where: { customerId: id } }),
      ]);

    return { customer, bills, loyaltyTransactions, redemptionTransactions, payments };
  }

  // Section 17.11 — right to erasure, SCOPED TO THIS PUMP MEMBERSHIP ROW
  // ONLY. Anonymizes (does not hard-delete) name/phone/vehicleNumber/
  // companyName: Bill/LoyaltyTransaction/Payment rows referencing this
  // customerId are kept intact for financial/audit retention (Tally export
  // history, bill audit trail) — erasing the row entirely would either
  // cascade-delete or orphan those, and this schema has no soft-delete
  // convention for Customer to fall back on either.
  //
  // KNOWN LIMITATION, documented rather than silently ignored: phone is
  // denormalized from CustomerAccount, which is NOT touched here. A
  // customer who is also a member at a different pump keeps that other
  // membership (and CustomerAccount-level login) fully intact — scrubbing
  // CustomerAccount.phone would break that other pump's login outright, and
  // whether/how erasure should propagate across a shared login identity is
  // a genuine legal question (does DPDP erasure apply per-controller/
  // per-pump-relationship, or per data principal globally?) this codebase
  // has no answer for — flagged here rather than guessed.
  async requestDeletion(id: string) {
    const customer = await this.findOne(id);
    if (customer.dataDeletedAt) {
      throw new ConflictException(`Customer ${id} was already anonymized at ${customer.dataDeletedAt.toISOString()}`);
    }
    return this.prisma.customer.update({
      where: { id },
      data: {
        name: 'Deleted Customer',
        phone: null,
        vehicleNumber: null,
        companyName: null,
        dataDeletedAt: new Date(),
      },
    });
  }

  private handlePrismaError(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException(
        'A customer with this phone number already exists',
      );
    }
    throw error;
  }
}
