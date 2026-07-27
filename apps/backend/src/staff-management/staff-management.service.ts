import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { requireTenantContext } from '../common/tenant-context';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { bumpStaffAccountTokenVersion } from './bump-staff-account-token-version';

const SALT_ROUNDS = 10;

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
  monthlySalary: true,
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
  //
  // Phase 2 — pumpId is deliberately NOT set explicitly on the
  // tx.staff.create() below: tenant-scoping.extension.ts auto-stamps it
  // from the request's tenant context (Staff is in TENANT_SCOPED_MODELS).
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
            pumpId: requireTenantContext().pumpId,
            accountId: account.id,
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

    // Once dto.role can change the role in the SAME request as a pin/password
    // reset, the pin-vs-password validation below must check against the
    // EFFECTIVE role this update will leave the staff member in
    // (dto.role ?? existing.role), not the stale pre-update role — otherwise
    // e.g. supplying a new pin alongside a role change TO DSM would
    // incorrectly fail against existing.role (still non-DSM at this point).
    const effectiveRole = dto.role ?? existing.role;
    if (dto.pin && effectiveRole !== Role.DSM) {
      throw new BadRequestException(
        `Staff ${id} has role ${effectiveRole}, which logs in with a password, not a pin — a pin reset only applies to role DSM`,
      );
    }
    if (dto.password && effectiveRole === Role.DSM) {
      throw new BadRequestException(
        `Staff ${id} has role DSM, which logs in with a pin, not a password — a password reset does not apply to role DSM`,
      );
    }

    // Section 3.7 gap resolution (see UpdateStaffDto's class comment) — a
    // role change that crosses the DSM <-> non-DSM boundary changes which
    // credential field is valid, so the caller MUST supply the new
    // credential type in this same request rather than leaving the staff
    // member unable to log in with either. A role change that does NOT
    // cross the boundary (e.g. OWNER -> ACCOUNTANT, or DSM -> DSM as a
    // no-op) needs no forced reset — the checks above already reject the
    // WRONG credential type being supplied optionally, same as before.
    const roleBoundaryCrossed =
      dto.role !== undefined && (existing.role === Role.DSM) !== (dto.role === Role.DSM);
    if (roleBoundaryCrossed && dto.role === Role.DSM && !dto.pin) {
      throw new BadRequestException(
        `Staff ${id} is changing role to DSM — a new pin is required in this same request, since the existing passwordHash will no longer be valid for a DSM login`,
      );
    }
    if (roleBoundaryCrossed && dto.role !== Role.DSM && !dto.password) {
      throw new BadRequestException(
        `Staff ${id} is changing role away from DSM (to ${dto.role}) — a new password is required in this same request, since the existing pinHash will no longer be valid for role ${dto.role}`,
      );
    }

    const pinHash = dto.pin ? await bcrypt.hash(dto.pin, SALT_ROUNDS) : undefined;
    const passwordHash = dto.password ? await bcrypt.hash(dto.password, SALT_ROUNDS) : undefined;

    // Session revocation triggers — bumping StaffAccount.tokenVersion
    // invalidates every JWT issued before this update at once (see
    // JwtStrategy.validate(), which re-checks the token's tokenVersion claim
    // against this live DB value on every request). Three independent
    // reasons this update needs to kill outstanding sessions, all funnelled
    // through the same bumpStaffAccountTokenVersion() helper:
    //   - Deactivation (dto.active === false) — the account should stop
    //     working immediately, not linger until the token's natural 12h
    //     expiry.
    //   - A pin or password reset (pinHash/passwordHash being set) —
    //     resetting a credential is often a response to it being
    //     compromised; leaving an old session alive on the OLD credential
    //     would defeat the point of resetting it.
    //   - A role change (dto.role !== undefined && dto.role !== existing.role)
    //     — RolesGuard reads `role` straight off the JWT payload (see
    //     jwt-payload.interface.ts's comment), so an un-bumped token would
    //     keep authorizing requests under the OLD role until it naturally
    //     expires. That's not minor staleness, it's real privilege drift: an
    //     Owner demoting someone to READ_ONLY (or promoting them) expects it
    //     to take effect immediately, not up to 12h later.
    // Reactivating (dto.active === true) deliberately does NOT bump it —
    // there's nothing to revoke on the way back in — and an update that
    // touches none of the above is unrelated to this mechanism entirely.
    const shouldBumpTokenVersion =
      dto.active === false ||
      pinHash !== undefined ||
      passwordHash !== undefined ||
      (dto.role !== undefined && dto.role !== existing.role);

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Owner is the ONLY role that can create/edit staff at all (see
        // StaffManagementController's class/method-level @Roles(Role.OWNER)
        // on create/update) — so demoting or deactivating the LAST remaining
        // active Owner at a pump would strand it with nobody able to fix the
        // mistake, including by re-promoting someone back to Owner. Checked
        // here, inside the transaction, against `tx` rather than
        // `this.prisma`: not a full fix for the race between this count and
        // the write landing (that would need a stricter isolation level),
        // but it meaningfully narrows the window compared to a check done
        // before the transaction even opens.
        const wasActiveOwner = existing.role === Role.OWNER && existing.active;
        const losingActiveOwnerStatus =
          wasActiveOwner &&
          ((dto.role !== undefined && dto.role !== Role.OWNER) || dto.active === false);
        if (losingActiveOwnerStatus) {
          const otherActiveOwners = await tx.staff.count({
            where: { pumpId: existing.pumpId, role: Role.OWNER, active: true, id: { not: existing.id } },
          });
          if (otherActiveOwners === 0) {
            const isRoleChange = dto.role !== undefined && dto.role !== Role.OWNER;
            throw new BadRequestException(
              isRoleChange
                ? 'Cannot change role: at least one Owner must remain for this pump'
                : 'Cannot deactivate: at least one Owner must remain for this pump',
            );
          }
        }

        // name/phone/credential live on the account; active/role are
        // per-membership (role also lives on Staff, not StaffAccount — see
        // schema comment). name is also denormalized onto the membership
        // row (see schema comment) — kept in sync here so existing readers
        // of Staff.name never see it drift from the account.
        //
        // When a role change crosses the DSM <-> non-DSM boundary, the
        // now-invalid OLD credential field is explicitly nulled out here
        // (moving TO DSM nulls passwordHash; moving AWAY FROM DSM nulls
        // pinHash) rather than left as a stale hash nobody can use — the
        // validation above already guaranteed the NEW credential
        // (pinHash/passwordHash) is being set in the same request, so no
        // staff member is ever left with zero valid credentials.
        await tx.staffAccount.update({
          where: { id: existing.accountId! },
          data: {
            ...(dto.name !== undefined ? { name: dto.name } : {}),
            ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
            ...(pinHash ? { pinHash } : {}),
            ...(passwordHash ? { passwordHash } : {}),
            ...(roleBoundaryCrossed && dto.role === Role.DSM ? { passwordHash: null } : {}),
            ...(roleBoundaryCrossed && dto.role !== Role.DSM ? { pinHash: null } : {}),
          },
        });
        // Separate statement in the SAME transaction as the account update
        // above (and the membership update below) — still one atomic unit,
        // see bumpStaffAccountTokenVersion()'s own comment for why this
        // takes `tx` rather than reaching for `this.prisma` directly.
        if (shouldBumpTokenVersion) {
          await bumpStaffAccountTokenVersion(tx, existing.accountId!);
        }
        const membership = await tx.staff.update({
          where: { id },
          data: {
            ...(dto.name !== undefined ? { name: dto.name } : {}),
            ...(dto.active !== undefined ? { active: dto.active } : {}),
            ...(dto.monthlySalary !== undefined ? { monthlySalary: dto.monthlySalary } : {}),
            ...(dto.role !== undefined ? { role: dto.role } : {}),
          },
          select: SAFE_SELECT,
        });
        return toStaffDto(membership);
      });
    } catch (error) {
      this.handlePrismaError(error, dto.phone ?? existing.account.phone);
    }
  }

  // Manual unlock — lets an Owner/Accountant (see the controller's
  // class-level @Roles) immediately clear another staff member's login
  // lockout instead of making them wait out the escalating cooldown (see
  // LOCKOUT_ESCALATION_DURATIONS_MS in auth/login-throttle.constants.ts).
  // Deliberately does NOT call bumpStaffAccountTokenVersion() — unlike
  // update()'s deactivation/credential-reset/role-change triggers, clearing
  // a lockout doesn't invalidate an already-issued session; it only stops
  // BLOCKING new login attempts, so there is no outstanding JWT that needs
  // to be killed here.
  //
  // Resets the same three fields, the same way, as AuthService's private
  // resetLoginLockout() (a successful login) — see that method's comment —
  // but implemented separately here since it lives on a different
  // service/table-of-concerns and isn't triggered by a login at all.
  async clearLockout(id: string) {
    const existing = await this.prisma.staff.findUnique({
      where: { id },
      include: { account: true },
    });
    if (!existing) {
      throw new NotFoundException(`Staff ${id} not found`);
    }
    if (!existing.accountId || !existing.account) {
      // Mirrors update()'s identical guard above — shouldn't happen post
      // Phase 0.2, but a staff row with no linked account has no lockout
      // state to clear either.
      throw new BadRequestException(`Staff ${id} has no linked account — cannot clear lockout`);
    }

    await this.prisma.staffAccount.update({
      where: { id: existing.accountId },
      data: { failedLoginAttempts: 0, lockedUntil: null, lockoutEscalationLevel: 0 },
    });

    // Re-select through the same SAFE_SELECT projection used everywhere else
    // in this service, so the response shape stays consistent with
    // findAll()/create()/update() rather than inventing a new one.
    const membership = await this.prisma.staff.findUniqueOrThrow({
      where: { id },
      select: SAFE_SELECT,
    });
    return toStaffDto(membership);
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
