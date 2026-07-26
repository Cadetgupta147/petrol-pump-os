import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BlacklistStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { requireTenantContext } from '../common/tenant-context';
import { CreateVehicleBlacklistDto } from './dto/create-vehicle-blacklist.dto';
import { ResolveVehicleBlacklistDto } from './dto/resolve-vehicle-blacklist.dto';
import { normalizeVehicleNumber } from './normalize-vehicle-number';

// Input to assertNotBlacklisted() — deliberately takes an ARRAY of vehicle
// number candidates, not one string. A bill can carry more than one
// plausible vehicle identifier at once (dto.vehicleNumber the DSM typed vs.
// customer.vehicleNumber already on file, if they differ) and either being
// blacklisted should block the bill.
export interface BlacklistCheckInput {
  vehicleNumbers?: (string | null | undefined)[];
  companyName?: string | null;
  customerId?: string | null;
}

// Section 3.4B (docs/master-plan.md) — see the VehicleBlacklist model's
// comment in schema.prisma for the full design rationale (why this is
// per-pump only, why there's no face-match or location field). This service
// is the enforcement half of that model — BillsService.create() calls
// assertNotBlacklisted() before ever touching the DB for a CREDIT bill.
//
// Auth/role guards apply via VehicleBlacklistController's @Roles — this
// service itself does no role checking, same separation as every other
// service in this codebase.
@Injectable()
export class VehicleBlacklistService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateVehicleBlacklistDto, blacklistedById: string) {
    // Re-check the scope/field pairing server-side —
    // CreateVehicleBlacklistDto's @ValidateIf only protects the HTTP entry
    // point, not every caller.
    if (dto.scope === 'VEHICLE' && !dto.vehicleNumber?.trim()) {
      throw new BadRequestException(
        'vehicleNumber is required when scope is VEHICLE',
      );
    }
    if (dto.scope === 'COMPANY' && !dto.companyName?.trim()) {
      throw new BadRequestException(
        'companyName is required when scope is COMPANY',
      );
    }

    if (dto.customerId) {
      const customer = await this.prisma.customer.findUnique({
        where: { id: dto.customerId },
      });
      if (!customer) {
        throw new NotFoundException(`Customer ${dto.customerId} not found`);
      }
    }

    const normalizedVehicleNumber = dto.vehicleNumber
      ? normalizeVehicleNumber(dto.vehicleNumber)
      : undefined;
    const trimmedCompanyName = dto.companyName?.trim();

    // Refuse a second ACTIVE entry for the same vehicle/company rather than
    // silently allowing duplicates — a re-offense after resolution should go
    // through create() again (fine, that's a NEW entry), but two
    // simultaneously-active entries for the same subject would just be
    // confusing to work with (which one has the real reason/amount?).
    const existingActive = await this.prisma.vehicleBlacklist.findFirst({
      where: {
        status: 'ACTIVE',
        ...(dto.scope === 'VEHICLE'
          ? { scope: 'VEHICLE', vehicleNumber: normalizedVehicleNumber }
          : {
              scope: 'COMPANY',
              companyName: { equals: trimmedCompanyName, mode: 'insensitive' },
            }),
      },
    });
    if (existingActive) {
      throw new ConflictException(
        `${
          dto.scope === 'VEHICLE'
            ? `Vehicle ${normalizedVehicleNumber}`
            : `Company ${trimmedCompanyName}`
        } already has an active blacklist entry (${existingActive.id})`,
      );
    }

    const pumpId = requireTenantContext().pumpId;
    return this.prisma.vehicleBlacklist.create({
      data: {
        pumpId,
        scope: dto.scope,
        vehicleNumber: normalizedVehicleNumber,
        companyName: trimmedCompanyName,
        customerId: dto.customerId,
        reason: dto.reason,
        outstandingAmount: dto.outstandingAmount ?? 0,
        referencePhotoUrl: dto.referencePhotoUrl,
        blacklistedById,
      },
    });
  }

  async findAll(status?: BlacklistStatus) {
    return this.prisma.vehicleBlacklist.findMany({
      where: status ? { status } : undefined,
      orderBy: { blacklistedAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const entry = await this.prisma.vehicleBlacklist.findUnique({
      where: { id },
    });
    if (!entry) {
      throw new NotFoundException(`Vehicle blacklist entry ${id} not found`);
    }
    return entry;
  }

  async resolve(
    id: string,
    dto: ResolveVehicleBlacklistDto,
    resolvedById: string,
  ) {
    const existing = await this.findOne(id);
    if (existing.status === 'RESOLVED') {
      throw new ConflictException('This blacklist entry is already resolved');
    }

    return this.prisma.vehicleBlacklist.update({
      where: { id },
      data: {
        status: 'RESOLVED',
        resolvedById,
        resolvedAt: new Date(),
        resolutionNote: dto.resolutionNote,
      },
    });
  }

  // Shared lookup — both assertNotBlacklisted() (throws, used by
  // BillsService.create()) and checkBlock() (returns, used by the
  // GET /vehicle-blacklist/check pre-check endpoint) call this SAME query,
  // so a DSM app's "is this OK to fuel" check can never drift out of sync
  // with what actually gets enforced at bill-creation time.
  private async findBlockingEntry(input: BlacklistCheckInput) {
    const normalizedNumbers = Array.from(
      new Set(
        (input.vehicleNumbers ?? [])
          .filter((v): v is string => !!v?.trim())
          .map(normalizeVehicleNumber),
      ),
    );
    const trimmedCompanyName = input.companyName?.trim();

    const orConditions: Prisma.VehicleBlacklistWhereInput[] = [];
    if (normalizedNumbers.length > 0) {
      orConditions.push({
        scope: 'VEHICLE',
        vehicleNumber: { in: normalizedNumbers },
      });
    }
    if (trimmedCompanyName) {
      orConditions.push({
        scope: 'COMPANY',
        companyName: { equals: trimmedCompanyName, mode: 'insensitive' },
      });
    }
    if (input.customerId) {
      orConditions.push({ customerId: input.customerId });
    }

    if (orConditions.length === 0) {
      return null;
    }

    return this.prisma.vehicleBlacklist.findFirst({
      where: { status: 'ACTIVE', OR: orConditions },
    });
  }

  // Non-throwing pre-check — GET /vehicle-blacklist/check. Lets the DSM app
  // (or web portal) ask "is this OK to fuel on credit" BEFORE the staff
  // commits to the sale, per the actual workflow this feature is for: check
  // first, then decide, rather than only finding out via a rejected
  // POST /bills.
  async checkBlock(input: BlacklistCheckInput) {
    const entry = await this.findBlockingEntry(input);
    return { blocked: entry !== null, entry };
  }

  // The actual enforcement call — BillsService.create() calls this before
  // committing a CREDIT bill. Throws rather than returning a boolean: every
  // call site wants the same "block the bill, explain why" behavior, so
  // there is no legitimate caller that wants a non-throwing check here (use
  // checkBlock() for that instead — this is enforcement, not a UI hint).
  async assertNotBlacklisted(input: BlacklistCheckInput): Promise<void> {
    const match = await this.findBlockingEntry(input);

    if (match) {
      const subject =
        match.scope === 'VEHICLE'
          ? `Vehicle ${match.vehicleNumber}`
          : `Company ${match.companyName}`;
      const outstandingNote =
        match.outstandingAmount > 0
          ? ` (₹${match.outstandingAmount.toFixed(2)} outstanding)`
          : '';
      throw new BadRequestException(
        `${subject} is blacklisted: ${match.reason}${outstandingNote}. ` +
          `Clear the prior dues, then resolve the entry (PATCH /vehicle-blacklist/${match.id}/resolve) before extending credit again.`,
      );
    }
  }
}
