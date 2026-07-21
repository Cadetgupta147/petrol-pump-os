import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';

const SALT_ROUNDS = 10;

// Never select pinHash/passwordHash out of the DB for this screen — the
// management UI needs to know a staff member exists and what role they
// have, never their credential hash.
const SAFE_SELECT = {
  id: true,
  name: true,
  phone: true,
  role: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.StaffSelect;

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

  findAll() {
    return this.prisma.staff.findMany({
      select: SAFE_SELECT,
      orderBy: { name: 'asc' },
    });
  }

  async create(dto: CreateStaffDto) {
    const { pinHash, passwordHash } = await this.resolveCredential(dto.role, {
      pin: dto.pin,
      password: dto.password,
    });

    try {
      return await this.prisma.staff.create({
        data: {
          name: dto.name,
          phone: dto.phone,
          role: dto.role,
          pinHash,
          passwordHash,
        },
        select: SAFE_SELECT,
      });
    } catch (error) {
      this.handlePrismaError(error, dto.phone);
    }
  }

  async update(id: string, dto: UpdateStaffDto) {
    const existing = await this.prisma.staff.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Staff ${id} not found`);
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
      return await this.prisma.staff.update({
        where: { id },
        data: {
          name: dto.name,
          phone: dto.phone,
          active: dto.active,
          ...(pinHash ? { pinHash } : {}),
          ...(passwordHash ? { passwordHash } : {}),
        },
        select: SAFE_SELECT,
      });
    } catch (error) {
      this.handlePrismaError(error, dto.phone ?? existing.phone);
    }
  }

  // Section 4 / Staff schema comment — DSM logs in with a pin only, every
  // other role logs in with a password only. Rejects the wrong credential
  // for the role (not just "requires the right one is missing"), since a
  // client sending both would otherwise silently succeed with one ignored.
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
