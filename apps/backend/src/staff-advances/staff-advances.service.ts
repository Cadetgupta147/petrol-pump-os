import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/types/jwt-payload.interface';
import { resolveAssignableActorId } from '../common/resolve-assignable-actor';
import { requireTenantContext } from '../common/tenant-context';
import { CreateStaffAdvanceDto } from './dto/create-staff-advance.dto';

// Section 17.23 — staff wage/advances, the "advances" half (monthlySalary
// itself lives on Staff, edited via staff-management). SIMPLIFICATION,
// flagged per prisma/schema.prisma's StaffAdvance comment: repayment is
// all-or-nothing (repaidAt set = fully settled), no partial-repayment
// ledger — a real payroll system would likely need that, out of scope here.
//
// Auth: enforced at the controller level (global JwtAuthGuard + RolesGuard,
// see staff-advances.controller.ts) — Owner/Accountant/Manager, matching
// CashCustodyController's role set (this is the same class of routine
// cash-handling bookkeeping).
@Injectable()
export class StaffAdvancesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateStaffAdvanceDto, user: AuthenticatedUser) {
    const staffId = resolveAssignableActorId(user, dto.staffId);
    return this.prisma.staffAdvance.create({
      data: {
        // Phase 0.3 — pumpId is required on the Prisma input type; the
        // extension would also inject it at runtime, but TypeScript can't
        // see that (same reasoning as every other top-level create() in
        // this codebase — see CustomersService.create()'s comment).
        pumpId: requireTenantContext().pumpId,
        staffId,
        amount: dto.amount,
        note: dto.note,
        recordedById: user.staffId,
      },
    });
  }

  findAll(params: { staffId?: string } = {}) {
    return this.prisma.staffAdvance.findMany({
      where: { ...(params.staffId && { staffId: params.staffId }) },
      include: { staff: { select: { id: true, name: true } } },
      orderBy: { givenAt: 'desc' },
    });
  }

  async markRepaid(id: string) {
    const existing = await this.prisma.staffAdvance.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`StaffAdvance ${id} not found`);
    }
    if (existing.repaidAt !== null) {
      throw new ConflictException(`StaffAdvance ${id} is already marked repaid`);
    }
    return this.prisma.staffAdvance.update({
      where: { id },
      data: { repaidAt: new Date() },
    });
  }

  // Consumed by AttendanceService.getSummary() to fold "salary due" into
  // the Section 12 hours-worked report — same "expose a resolver, let the
  // consumer merge it" shape as TaxRateConfigService.resolveTaxRateMap().
  // Sums OUTSTANDING (repaidAt === null) advances regardless of date range —
  // an advance given last month against a salary not yet paid out is still
  // a real deduction today, so this deliberately ignores whatever from/to
  // window the caller's report is scoped to.
  async getOutstandingTotalsByStaff(): Promise<Record<string, number>> {
    const outstanding = await this.prisma.staffAdvance.findMany({
      where: { repaidAt: null },
      select: { staffId: true, amount: true },
    });
    const totals: Record<string, number> = {};
    for (const row of outstanding) {
      totals[row.staffId] = (totals[row.staffId] ?? 0) + row.amount;
    }
    return totals;
  }
}
