import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDensityLogDto } from './dto/create-density-log.dto';

// Section 7.3 — density/quality check. Optionally linked to the delivery
// (PurchaseEntry) or physical stock check (DipReading) that prompted it —
// see purchases.service.ts / tanks.service.ts for the two linked-creation
// call sites, which both reuse computeDensityFlag() below directly (they
// create the DensityLog row inside their OWN transaction, not through this
// service, so the flagging math is factored out as a pure function rather
// than duplicated — same pattern as computeLoyaltyPoints() in
// loyalty.service.ts).
//
// Auth: enforced at the controller level (global JwtAuthGuard + RolesGuard,
// see density-logs.controller.ts) — Owner/Accountant/DSM for creation
// (matches DIP reading creation's role set — physical/quality readings are
// plausibly a DSM task too), Owner/Accountant only for reads (matches the
// read-side restriction already used for DIP reading history and tank
// reads).

// Section 7.3 says "optional acceptable-range flag (out-of-range readings
// can trigger an alert same as low stock)" but specifies no numbers — same
// situation as DIP_VARIANCE_TOLERANCE_LITRES (tanks.service.ts) and
// VARIANCE_TOLERANCE_LITRES (meter-readings.service.ts). Kept only as a
// built-in fallback (Section 17.19) for a pump that hasn't configured its
// own range yet — reasonable real-world density bands (g/mL) for the two
// common fuel grades, NOT sourced from any dealer/OMC configuration. Real
// per-pump ranges belong in DensityRangeConfig (prisma/schema.prisma) —
// see resolveDensityRangeMap() below, which is what every real call site
// actually uses.
//
// A product with no default AND no configured DensityRangeConfig row has NO
// known range to flag against, so flagged always stays false for it — this
// is documented, intentional behavior (not a bug / not an attempt to guess a
// range for an unlisted product), see computeDensityFlag() below.
export const DEFAULT_DENSITY_RANGE_BY_PRODUCT: Record<
  string,
  { min: number; max: number }
> = {
  petrol: { min: 0.72, max: 0.775 }, // MS (motor spirit), g/mL
  diesel: { min: 0.82, max: 0.87 }, // HSD (high-speed diesel), g/mL
};

// Section 17.19 — merges this pump's DensityRangeConfig rows (if any) over
// DEFAULT_DENSITY_RANGE_BY_PRODUCT, so a dealer-configured range always wins
// for a product it covers. Every real call site (DensityLogsService.create()
// below, PurchasesService.create(), TanksService.recordDipReading()) awaits
// this before calling computeDensityFlag() — it's a separate async step
// rather than folded into that function so computeDensityFlag() itself stays
// a plain, easily-unit-tested pure function.
export async function resolveDensityRangeMap(
  prisma: PrismaService,
): Promise<Record<string, { min: number; max: number }>> {
  const overrides = await prisma.densityRangeConfig.findMany();
  const map = { ...DEFAULT_DENSITY_RANGE_BY_PRODUCT };
  for (const row of overrides) {
    map[row.productType] = { min: row.minDensity, max: row.maxDensity };
  }
  return map;
}

// Pure function, shared by DensityLogsService.create() below and the linked
// creation paths inside PurchasesService.create() / TanksService.
// recordDipReading() (both create the DensityLog row inside their own
// transaction, so they can't go through this service's create() — see those
// files). `rangeByProduct` defaults to the built-in placeholder map so
// existing unit tests that only care about the flagging math itself don't
// need to fetch/construct one — real callers always pass an explicit,
// resolved map from resolveDensityRangeMap() above.
export function computeDensityFlag(
  productType: string,
  densityValue: number,
  rangeByProduct: Record<
    string,
    { min: number; max: number }
  > = DEFAULT_DENSITY_RANGE_BY_PRODUCT,
): boolean {
  const range = rangeByProduct[productType];
  if (!range) {
    // Unknown product — no known range to flag against. Documented
    // behavior, not a silent guess (see the map's comment above).
    return false;
  }
  return densityValue < range.min || densityValue > range.max;
}

@Injectable()
export class DensityLogsService {
  constructor(private readonly prisma: PrismaService) {}

  // Finding A1 — recordedById is not a DTO field; DensityLogsController
  // derives it from req.user.staffId and passes it as its own argument.
  async create(dto: CreateDensityLogDto, recordedById: string) {
    const tank = await this.prisma.tank.findUnique({
      where: { id: dto.tankId },
    });
    if (!tank) {
      throw new NotFoundException(`Tank ${dto.tankId} not found`);
    }

    const rangeMap = await resolveDensityRangeMap(this.prisma);
    const flagged = computeDensityFlag(tank.productType, dto.densityValue, rangeMap);

    return this.prisma.densityLog.create({
      data: {
        // Phase 0.3 (docs/multi-tenancy-plan.md) — pumpId is required now;
        // reuses the tank's own pumpId (already fetched above) rather than
        // requireTenantContext(), since a DensityLog belongs to whichever
        // pump owns the tank it's about.
        pumpId: tank.pumpId,
        tankId: dto.tankId,
        densityValue: dto.densityValue,
        ppmValue: dto.ppmValue,
        recordedById,
        purchaseEntryId: dto.purchaseEntryId,
        dipReadingId: dto.dipReadingId,
        flagged,
      },
    });
  }

  findAll(params: {
    tankId?: string;
    purchaseEntryId?: string;
    dipReadingId?: string;
  }) {
    const { tankId, purchaseEntryId, dipReadingId } = params;
    return this.prisma.densityLog.findMany({
      where: {
        ...(tankId && { tankId }),
        ...(purchaseEntryId && { purchaseEntryId }),
        ...(dipReadingId && { dipReadingId }),
      },
      orderBy: { recordedAt: 'desc' },
    });
  }
}
