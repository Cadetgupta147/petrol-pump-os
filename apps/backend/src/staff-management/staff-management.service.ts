import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';

const SALT_ROUNDS = 10;

// Phase 0.2 (docs/multi-tenancy-plan.md): hardcoded until Phase 2's
// AsyncLocalStorage tenant context exists — same interim pattern used
// across every service touched in that phase.
const DEFAULT_PUMP_ID = 'default_pump';

// Never select pinHash/passwordHash out of the DB for this screen — the
// management UI needs to know a staff member exists and what role they
// have, never their credential hash. Phase 0.2 split the credential off
// Staff onto StaffAccount — phone now comes from the joined account, not a
// direct column, but the flattened response shape (toStaffDto below) stays
// identical to what this endpoint returned before the split.
const SAFE_SELECT = {
  id: true,
  name: true,
  role: true,
  active: true,
  createdAt: true,
  updatedAt: true,
  account: { select: { phone: true } },
} satisfies Prisma.StaffSelect;

type StaffRow = Prisma.StaffGetPayload<{ select: typeof SAFE_SELECT }>;

function toStaffDto(row: StaffRow) {
  const { account, ...rest } = row;
  return { ...rest, phone: account?.phone ?? '' };
}

// Section 3.7 — Staff Management: create/edit the staff master (distinct
// from StaffService's minimal id+name picker directory at GET /staff, which
// predates this and stays as-is for its existing callers).
//
// Auth: enforced at the controller level. Per docs/master-plan.md Section 2,
// Accountant explicitly "cannot edit staff PINs" — since creating a staff
// member always sets an initial credential, and editing can reset one, this
// service treats the whole create/update surface as Owner-only rather than
// only gating the credential fields specifically. View (GET) is
// Owner/Accountant, matching Accountant's general "view all reports" access.
// This is a judgment call, not something Section 2 states explicitly beyond
// the PIN restriction — flagged here per CLAUDE.md rather than silently
// assumed.
@Injectable()
export class StaffManagementService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const rows = await this.prisma.staff.findMany({
      select: SAFE_SELECT,
      orderBy: { name: 'asc' },
    });
    return rows.map(toStaffDto);
  }

  // Phase 0.2 — creates a StaffAccount (the login identity/credential) and
  // a Staff row (the per-pump membership) together, atomically. A person
  // with memberships at more than one pump would get a second Staff row
  // linked to the SAME account (not built here — this endpoint always
  // creates a brand-new account, since there's no "add an existing person
  // to this pump" flow yet).
  async create(dto: CreateStaffDto) {
    const { pinHash, passwordHash } = await this.resolveCredential(dto.role, {
      pin: dto.pin,
      password: dto.password,
    });

    try {
      return await this.prisma.$transaction(async (tx) => {
        const account = await tx.staffAccount.create({
          data: { name: dto.name, phone: dto.phone, pinHash, passwordHash },
        });
        const membership = await tx.staff.create({
          data: {
            accountId: account.id,
            pumpId: DEFAULT_PUMP_ID,
            name: dto.name,
            role: dto.role,
          },
          select: SAFE_SELECT,
        });
        return toStaffDto(membership);
      });
    } catch (error) {
      this.handlePrismaError(error, dto.phone);
    }
  }

  async update(id: string, dto: UpdateStaffDto) {
    const existing = await this.prisma.staff.findUnique({
      where: { id },
      include: { account: true },
    });
    if (!existing) {
      throw new NotFoundException(`Staff ${id} not found`);
    }
    if (!existing.accountId || !existing.account) {
      // Shouldn't happen — create() always links an account — but a
      // pre-split legacy row (there shouldn't be any post-migration) would
      // hit this rather than silently no-op a credential reset.
      throw new BadRequestException(`Staff ${id} has no linked account — cannot update credentials`);
    }

    if (dto.pin && existing.role !== Role.DSM) {
      throw new BadRequestException(
        `Staff ${id} has role ${existing.role}, which logs in with a password, not a pin — a pin reset only applies to role DSM`,
      );
    }
    if (dto.password && existing.role === Role.DSM) {
      throw new BadRequestException(
        `Staff ${id} has role DSM, which logs in with a pin, not a password — a password reset does not apply to role DSM`,
      );
    }

    const pinHash = dto.pin ? await bcrypt.hash(dto.pin, SALT_ROUNDS) : undefined;
    const passwordHash = dto.password ? await bcrypt.hash(dto.password, SALT_ROUNDS) : undefined;

    try {
      return await this.prisma.$transaction(async (tx) => {
        // name/phone/credential live on the account; active is per-membership.
        // name is also denormalized onto the membership row (see schema
        // comment) — kept in sync here so existing readers of Staff.name
        // never see it drift from the account.
        await tx.staffAccount.update({
          where: { id: existing.accountId! },
          data: {
            ...(dto.name !== undefined ? { name: dto.name } : {}),
            ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
            ...(pinHash ? { pinHash } : {}),
            ...(passwordHash ? { passwordHash } : {}),
          },
        });
        const membership = await tx.staff.update({
          where: { id },
          data: {
            ...(dto.name !== undefined ? { name: dto.name } : {}),
            ...(dto.active !== undefined ? { active: dto.active } : {}),
          },
          select: SAFE_SELECT,
        });
        return toStaffDto(membership);
      });
    } catch (error) {
      this.handlePrismaError(error, dto.phone ?? existing.account.phone);
    }
  }

  // Section 4 / StaffAccount schema comment — DSM logs in with a pin only,
  // every other role logs in with a password only. Rejects the wrong
  // credential for the role (not just "requires the right one is missing"),
  // since a client sending both would otherwise silently succeed with one
  // ignored.
  private async resolveCredential(
    role: Role,
    creds: { pin?: string; password?: string },
  ): Promise<{ pinHash: string | null; passwordHash: string | null }> {
    if (role === Role.DSM) {
      if (!creds.pin) {
        throw new BadRequestException('pin is required for role DSM');
      }
      if (creds.password) {
        throw new BadRequestException(
          'password is not used for role DSM — DSM staff log in with a pin only',
        );
      }
      return { pinHash: await bcrypt.hash(creds.pin, SALT_ROUNDS), passwordHash: null };
    }

    if (!creds.password) {
      throw new BadRequestException(`password is required for role ${role}`);
    }
    if (creds.pin) {
      throw new BadRequestException(
        `pin is not used for role ${role} — only role DSM logs in with a pin`,
      );
    }
    return { pinHash: null, passwordHash: await bcrypt.hash(creds.password, SALT_ROUNDS) };
  }

  private handlePrismaError(error: unknown, phone: string): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        throw new ConflictException(`Phone ${phone} is already in use by another staff member`);
      }
    }
    throw error;
  }
}
