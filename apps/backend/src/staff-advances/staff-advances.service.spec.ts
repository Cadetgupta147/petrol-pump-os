import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { StaffAdvancesService } from './staff-advances.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/types/jwt-payload.interface';
import { runInTenantContext } from '../common/tenant-context';

const PUMP_ID = 'pump-1';
const dsmCaller: AuthenticatedUser = { staffId: 'dsm-1', pumpId: 'pump-1', role: Role.DSM };
const managerCaller: AuthenticatedUser = { staffId: 'manager-1', pumpId: 'pump-1', role: Role.MANAGER };

// Section 17.23 — staff wage/advances. Covers: resolveAssignableActorId()
// coverage (same pattern as AttendanceService.clockIn()), the all-or-nothing
// repayment guard, and getOutstandingTotalsByStaff()'s grouping — the piece
// AttendanceService.getSummary() actually consumes.
describe('StaffAdvancesService', () => {
  let service: StaffAdvancesService;
  let prisma: {
    staffAdvance: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      staffAdvance: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [StaffAdvancesService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(StaffAdvancesService);
  });

  describe('create', () => {
    it('defaults staffId to the caller when omitted, with recordedById always the caller', async () => {
      prisma.staffAdvance.create.mockResolvedValue({ id: 'adv-1' });

      await runInTenantContext({ pumpId: PUMP_ID }, () => service.create({ amount: 2000 }, dsmCaller));

      expect(prisma.staffAdvance.create).toHaveBeenCalledWith({
        data: {
          pumpId: PUMP_ID,
          staffId: 'dsm-1',
          amount: 2000,
          note: undefined,
          recordedById: 'dsm-1',
        },
      });
    });

    it('allows a non-DSM caller to record an advance for a different staff member', async () => {
      prisma.staffAdvance.create.mockResolvedValue({ id: 'adv-1' });

      await runInTenantContext({ pumpId: PUMP_ID }, () =>
        service.create({ staffId: 'other-staff', amount: 1500 }, managerCaller),
      );

      expect(prisma.staffAdvance.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ staffId: 'other-staff', recordedById: 'manager-1' }),
        }),
      );
    });

    it('rejects a DSM caller recording an advance for a different staff member', async () => {
      await expect(
        service.create({ staffId: 'other-staff', amount: 1500 }, dsmCaller),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.staffAdvance.create).not.toHaveBeenCalled();
    });
  });

  describe('markRepaid', () => {
    it('404s on an unknown id', async () => {
      prisma.staffAdvance.findUnique.mockResolvedValue(null);

      await expect(service.markRepaid('nope')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects re-marking an already-repaid advance', async () => {
      prisma.staffAdvance.findUnique.mockResolvedValue({ id: 'adv-1', repaidAt: new Date() });

      await expect(service.markRepaid('adv-1')).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.staffAdvance.update).not.toHaveBeenCalled();
    });

    it('stamps repaidAt on an outstanding advance', async () => {
      prisma.staffAdvance.findUnique.mockResolvedValue({ id: 'adv-1', repaidAt: null });
      prisma.staffAdvance.update.mockResolvedValue({ id: 'adv-1' });

      await service.markRepaid('adv-1');

      expect(prisma.staffAdvance.update).toHaveBeenCalledWith({
        where: { id: 'adv-1' },
        data: { repaidAt: expect.any(Date) as Date },
      });
    });
  });

  describe('getOutstandingTotalsByStaff', () => {
    it('sums only repaidAt === null rows, grouped by staffId', async () => {
      prisma.staffAdvance.findMany.mockResolvedValue([
        { staffId: 'staff-1', amount: 2000 },
        { staffId: 'staff-1', amount: 1000 },
        { staffId: 'staff-2', amount: 500 },
      ]);

      const totals = await service.getOutstandingTotalsByStaff();

      expect(prisma.staffAdvance.findMany).toHaveBeenCalledWith({
        where: { repaidAt: null },
        select: { staffId: true, amount: true },
      });
      expect(totals).toEqual({ 'staff-1': 3000, 'staff-2': 500 });
    });

    it('returns an empty map when nothing is outstanding', async () => {
      prisma.staffAdvance.findMany.mockResolvedValue([]);

      const totals = await service.getOutstandingTotalsByStaff();

      expect(totals).toEqual({});
    });
  });
});
