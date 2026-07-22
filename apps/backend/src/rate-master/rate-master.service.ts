import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { requireTenantContext } from '../common/tenant-context';
import { CreateRateHistoryDto } from './dto/create-rate-history.dto';

// Section 7.4 — Rate Master. Append-only price history per product,
// authoritative source for Bill.rateApplied at bill-creation time (see
// BillsService.create()) — the server resolves the rate itself rather than
// trusting a client-supplied value (CLAUDE.md: "never trust the frontend").
//
// Auth: enforced at the controller level (global JwtAuthGuard + RolesGuard,
// see rate-master.controller.ts) — Owner/Accountant only, matching
// TanksController's config-data scoping (there's no concrete DSM need to
// browse rate history directly). BillsService calls getCurrentRate()
// in-process as an injected provider, which bypasses HTTP entirely — so a
// DSM creating a bill still gets the resolved rate without needing route
// access to this controller.
//
// No update/delete here on purpose — same append-only philosophy as
// BillAuditLog: a rate correction is a new dated row, not an edit to
// history.
@Injectable()
export class RateMasterService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateRateHistoryDto) {
    return this.prisma.rateHistory.create({
      data: {
        pumpId: requireTenantContext().pumpId,
        productType: dto.productType,
        rate: dto.rate,
        effectiveFrom: new Date(dto.effectiveFrom),
      },
    });
  }

  findAll(productType?: string) {
    return this.prisma.rateHistory.findMany({
      where: productType ? { productType } : undefined,
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  // Resolves the rate in effect for `productType` as of `asOf` (defaults to
  // now): the latest `effectiveFrom <= asOf` row for that product. Future-
  // dated rows (effectiveFrom > asOf) are ignored — a rate can be scheduled
  // ahead of time without taking effect early.
  //
  // Throws NotFoundException when nothing is configured — this is meant to
  // surface loudly from bill creation (same hard-block precedent as
  // PurchasesService.create() with no matching Tank: 404, not a silent
  // default to 0).
  async getCurrentRate(productType: string, asOf: Date = new Date()) {
    const rate = await this.prisma.rateHistory.findFirst({
      where: { productType, effectiveFrom: { lte: asOf } },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!rate) {
      throw new NotFoundException(
        `No Rate Master entry configured for product ${productType} effective on or before ${asOf.toISOString()} — create one first via POST /rate-master`,
      );
    }
    return rate;
  }
}
