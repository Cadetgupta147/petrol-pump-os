import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { CashCustodyService } from './cash-custody.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/types/jwt-payload.interface';
import { runInTenantContext } from '../common/tenant-context';
import type { CreateCashCustodyLogDto } from './dto/create-cash-custody-log.dto';

// Caller staffId matches every dto.handledById used below ('staff-1'), so
// resolveAssignableActorId() resolves to the same value regardless of role
// — these tests aren't exercising the assignable-actor rule itself (see the
// dedicated describe block near the bottom for that), just the pre-existing
// money math, now routed through the (role, dto) signature.
const callingStaff: AuthenticatedUser = {
  staffId: 'staff-1',
  pumpId: 'pump-1',
  role: Role.MANAGER,
};
const dsmCaller: AuthenticatedUser = {
  staffId: 'dsm-1',
  pumpId: 'pump-1',
  role: Role.DSM,
};

// Section 8 — money-handling logic (CLAUDE.md: rule-heavy cash custody math
// needs tests). Covers the 3-way-split validation and the carry-forward
// math/clamping decision — the two places a bug would actually lose track
// of real money.
describe('CashCustodyService', () => {
  let service: CashCustodyService;

  let prisma: {
    cashCustodyLog: {
      findFirst: jest.Mock;
      create: jest.Mock;
    };
    staff: { findMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      cashCustodyLog: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      staff: { findMany: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CashCustodyService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(CashCustodyService);
  });

  // Phase 0.3 (docs/multi-tenancy-plan.md) — create() now reads
  // requireTenantContext().pumpId directly; every call site needs an
  // active tenant context.
  function createLog(dto: CreateCashCustodyLogDto, user: AuthenticatedUser = callingStaff) {
    return runInTenantContext({ pumpId: 'pump-1' }, () => service.create(dto, user));
  }

  describe('create — 3-way split validation', () => {
    it('rejects when depositedToBank + keptInLocker + takenHome !== totalCashCollected', async () => {
      await expect(
        createLog({
          date: '2026-07-20',
          totalCashCollected: 1000,
          depositedToBank: 500,
          keptInLocker: 300,
          takenHome: 100, // sums to 900, not 1000
          handledById: 'staff-1',
        }, callingStaff),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.cashCustodyLog.findFirst).not.toHaveBeenCalled();
    });

    it('accepts a split that balances within float epsilon', async () => {
      prisma.cashCustodyLog.findFirst
        .mockResolvedValueOnce(null) // no duplicate for this date
        .mockResolvedValueOnce(null); // no prior log -> cumulativeOutstandingBeforeToday = 0
      prisma.cashCustodyLog.create.mockResolvedValue({ id: 'log-1' });

      await createLog({
        date: '2026-07-20',
        totalCashCollected: 1000,
        depositedToBank: 500.005,
        keptInLocker: 300,
        takenHome: 199.999, // sums to 1000.004, within 0.01 epsilon
        handledById: 'staff-1',
      }, callingStaff);

      expect(prisma.cashCustodyLog.create).toHaveBeenCalled();
    });
  });

  describe('create — duplicate same-day entry', () => {
    it('rejects a second entry for the same handledBy staff + date', async () => {
      prisma.cashCustodyLog.findFirst.mockResolvedValueOnce({ id: 'existing' });

      await expect(
        createLog({
          date: '2026-07-20',
          totalCashCollected: 1000,
          depositedToBank: 700,
          keptInLocker: 200,
          takenHome: 100,
          handledById: 'staff-1',
        }, callingStaff),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('create — carry-forward math', () => {
    it('resolves cumulativeOutstandingBeforeToday from this staff member\'s most recent prior newOutstanding', async () => {
      prisma.cashCustodyLog.findFirst
        .mockResolvedValueOnce(null) // no duplicate for this date
        .mockResolvedValueOnce({ newOutstanding: 500 }); // prior day's carry
      prisma.cashCustodyLog.create.mockImplementation(({ data }) => data);

      const result = await createLog({
        date: '2026-07-21',
        totalCashCollected: 1000,
        depositedToBank: 700,
        keptInLocker: 200,
        takenHome: 100,
        handledById: 'staff-1',
        broughtBackToday: 200,
      }, callingStaff);

      // newOutstanding = (cumulativeOutstandingBeforeToday - broughtBackToday) + takenHome
      //                = (500 - 200) + 100 = 400
      expect(result.cumulativeOutstandingBeforeToday).toBe(500);
      expect(result.newOutstanding).toBe(400);
    });

    it('defaults cumulativeOutstandingBeforeToday to 0 when there is no prior entry for this staff member', async () => {
      prisma.cashCustodyLog.findFirst
        .mockResolvedValueOnce(null) // no duplicate for this date
        .mockResolvedValueOnce(null); // no prior entry
      prisma.cashCustodyLog.create.mockImplementation(({ data }) => data);

      const result = await createLog({
        date: '2026-07-20',
        totalCashCollected: 1000,
        depositedToBank: 700,
        keptInLocker: 200,
        takenHome: 100,
        handledById: 'staff-1',
      }, callingStaff);

      expect(result.cumulativeOutstandingBeforeToday).toBe(0);
      expect(result.newOutstanding).toBe(100); // (0 - 0) + 100
    });

    it('rejects when broughtBackToday exceeds cumulativeOutstandingBeforeToday (does not clamp/absorb the excess)', async () => {
      prisma.cashCustodyLog.findFirst
        .mockResolvedValueOnce(null) // no duplicate for this date
        .mockResolvedValueOnce({ newOutstanding: 300 }); // prior outstanding only 300

      await expect(
        createLog({
          date: '2026-07-21',
          totalCashCollected: 1000,
          depositedToBank: 700,
          keptInLocker: 200,
          takenHome: 100,
          handledById: 'staff-1',
          broughtBackToday: 500, // more than the 300 owed
        }, callingStaff),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.cashCustodyLog.create).not.toHaveBeenCalled();
    });

    it('never lets newOutstanding go negative (broughtBackToday fully settling the prior balance)', async () => {
      prisma.cashCustodyLog.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ newOutstanding: 200 });
      prisma.cashCustodyLog.create.mockImplementation(({ data }) => data);

      const result = await createLog({
        date: '2026-07-21',
        totalCashCollected: 1000,
        depositedToBank: 1000,
        keptInLocker: 0,
        takenHome: 0,
        handledById: 'staff-1',
        broughtBackToday: 200, // exactly settles it
      }, callingStaff);

      expect(result.newOutstanding).toBe(0);
    });
  });

  // Finding A1 (docs/production-readiness.md) — resolveAssignableActorId()
  // coverage: omitted handledById defaults to the caller, a non-DSM caller
  // can record for someone else, a DSM caller cannot.
  describe('create — handledById resolution (finding A1)', () => {
    beforeEach(() => {
      prisma.cashCustodyLog.findFirst
        .mockResolvedValueOnce(null) // no duplicate for this date
        .mockResolvedValueOnce(null); // no prior log
      prisma.cashCustodyLog.create.mockImplementation(({ data }) => data);
    });

    const balancedDto = {
      date: '2026-07-20',
      totalCashCollected: 1000,
      depositedToBank: 700,
      keptInLocker: 200,
      takenHome: 100,
    };

    it('defaults handledById to the caller when omitted', async () => {
      const result = await createLog(balancedDto, dsmCaller);
      expect(result.handledById).toBe('dsm-1');
    });

    it('allows a non-DSM caller to record for a different staff member', async () => {
      const result = await createLog(
        { ...balancedDto, handledById: 'other-staff' },
        callingStaff,
      );
      expect(result.handledById).toBe('other-staff');
    });

    it('rejects a DSM caller recording for a different staff member', async () => {
      await expect(
        createLog({ ...balancedDto, handledById: 'other-staff' }, dsmCaller),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.cashCustodyLog.findFirst).not.toHaveBeenCalled();
      expect(prisma.cashCustodyLog.create).not.toHaveBeenCalled();
    });
  });

  describe('getReport', () => {
    it('computes current outstanding and the streak-start date since the last fully-settled row', async () => {
      const day = (n: number) => new Date(`2026-07-${String(n).padStart(2, '0')}T00:00:00Z`);
      prisma.staff.findMany.mockResolvedValue([
        {
          id: 'staff-1',
          name: 'Ramesh',
          cashCustodyLogs: [
            { date: day(1), newOutstanding: 0 },
            { date: day(2), newOutstanding: 300 }, // streak starts here
            { date: day(3), newOutstanding: 450 },
          ],
        },
        {
          id: 'staff-2',
          name: 'Suresh',
          cashCustodyLogs: [
            { date: day(1), newOutstanding: 100 },
            { date: day(2), newOutstanding: 0 }, // fully settled -> no outstanding
          ],
        },
      ]);

      const report = await service.getReport();

      const ramesh = report.find((r) => r.staffId === 'staff-1')!;
      expect(ramesh.currentOutstanding).toBe(450);
      expect(ramesh.isCurrentlyOutstanding).toBe(true);
      expect(ramesh.outstandingSinceDate).toEqual(day(2));

      const suresh = report.find((r) => r.staffId === 'staff-2')!;
      expect(suresh.currentOutstanding).toBe(0);
      expect(suresh.isCurrentlyOutstanding).toBe(false);
      expect(suresh.outstandingSinceDate).toBeNull();
    });
  });
});
