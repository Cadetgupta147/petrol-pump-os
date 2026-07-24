import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { MeterReadingsService } from './meter-readings.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/types/jwt-payload.interface';
import { runInTenantContext } from '../common/tenant-context';
import type { OpenShiftDto } from './dto/open-shift.dto';

const dsmCaller: AuthenticatedUser = {
  staffId: 's1',
  pumpId: 'pump-1',
  role: Role.DSM,
};
const managerCaller: AuthenticatedUser = {
  staffId: 'manager-1',
  pumpId: 'pump-1',
  role: Role.MANAGER,
};
const accountantCaller: AuthenticatedUser = {
  staffId: 'accountant-1',
  pumpId: 'pump-1',
  role: Role.ACCOUNTANT,
};

const activeNozzle = {
  id: 'n1',
  pumpId: 'pump-1',
  label: 'N1',
  itemId: 'item-1',
  item: { id: 'item-1', name: 'petrol' },
  startingReading: 100,
  rolloverAt: null as number | null,
  isActive: true,
  createdAt: new Date(),
};

// Section 3.3 (pre-existing) + Section 7.2 step 2 (tank auto-deduction on
// shift close) + Section 3.3/4 Nozzle master carry-forward + meter rollover
// + shift backdating + the correction endpoint (all added by this slice).
// openShift() no longer accepts openingReading/productType from the client
// at all — both are derived from the Nozzle master and the carry-forward
// rule.
describe('MeterReadingsService', () => {
  let service: MeterReadingsService;

  type TxCallback = (tx: unknown) => Promise<unknown>;

  let prisma: {
    meterReading: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    nozzle: { findUnique: jest.Mock };
    tank: { findFirst: jest.Mock; update: jest.Mock };
    bill: { aggregate: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      meterReading: {
        findFirst: jest.fn().mockResolvedValue(null), // no open shift / no prior closed shift by default
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      nozzle: { findUnique: jest.fn().mockResolvedValue(activeNozzle) },
      tank: { findFirst: jest.fn(), update: jest.fn() },
      bill: { aggregate: jest.fn().mockResolvedValue({ _sum: { litres: null } }) },
      $transaction: jest.fn((cb: TxCallback) => cb(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MeterReadingsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(MeterReadingsService);
  });

  // Phase 0.3 (docs/multi-tenancy-plan.md) — openShift() now reads
  // requireTenantContext().pumpId directly (not just via
  // resolveAssignableActorId's user param); every call site needs an
  // active tenant context.
  function openShift(dto: OpenShiftDto, user: AuthenticatedUser) {
    return runInTenantContext({ pumpId: 'pump-1' }, () => service.openShift(dto, user));
  }

  describe('openShift', () => {
    it('derives openingReading (from Nozzle.startingReading) and productType (from the Nozzle\'s Item) — never from the request body', async () => {
      prisma.meterReading.create.mockResolvedValue({
        id: 'mr-1',
        nozzleId: 'n1',
        staffId: 's1',
        openingReading: 100,
        closingReading: null,
        shiftStart: new Date(),
        shiftEnd: null,
        productType: 'petrol',
        meterRolledOver: false,
        nozzle: activeNozzle,
      });

      await openShift({ nozzleId: 'n1', staffId: 's1' }, dsmCaller);

      expect(prisma.meterReading.create).toHaveBeenCalledWith({
        data: {
          pumpId: 'pump-1',
          nozzleId: 'n1',
          openLockNozzleId: 'n1',
          staffId: 's1',
          openingReading: 100, // == activeNozzle.startingReading — no prior closed shift
          productType: 'petrol',
        },
        include: { nozzle: true },
      });
    });

    it("carries forward the nozzle's last closed shift's closingReading as the new shift's openingReading", async () => {
      prisma.meterReading.findFirst
        .mockResolvedValueOnce(null) // "already has an open shift?" check
        .mockResolvedValueOnce({ closingReading: 5000 }); // resolveOpeningReading()'s lookup
      prisma.meterReading.create.mockResolvedValue({ id: 'mr-2', nozzle: activeNozzle });

      await openShift({ nozzleId: 'n1', staffId: 's1' }, dsmCaller);

      expect(prisma.meterReading.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ openingReading: 5000 }),
        }),
      );
    });

    it('404s when the nozzle does not exist', async () => {
      prisma.nozzle.findUnique.mockResolvedValue(null);

      await expect(
        openShift({ nozzleId: 'does-not-exist', staffId: 's1' }, dsmCaller),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.meterReading.create).not.toHaveBeenCalled();
    });

    it('404s when the nozzle has been soft-disabled (isActive: false)', async () => {
      prisma.nozzle.findUnique.mockResolvedValue({ ...activeNozzle, isActive: false });

      await expect(
        openShift({ nozzleId: 'n1', staffId: 's1' }, dsmCaller),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.meterReading.create).not.toHaveBeenCalled();
    });

    it('409s when the nozzle already has an open shift', async () => {
      prisma.meterReading.findFirst.mockResolvedValueOnce({ id: 'open-shift-1' });

      await expect(
        openShift({ nozzleId: 'n1', staffId: 's1' }, dsmCaller),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.meterReading.create).not.toHaveBeenCalled();
    });

    it('translates a P2002 (openLockNozzleId race) into a 409', async () => {
      const { Prisma } = jest.requireActual('@prisma/client');
      prisma.meterReading.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique violation', {
          code: 'P2002',
          clientVersion: '6.19.3',
        }),
      );

      await expect(
        openShift({ nozzleId: 'n1', staffId: 's1' }, dsmCaller),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    // Finding A1 (docs/production-readiness.md) — resolveAssignableActorId()
    // coverage, same pattern as AttendanceService/CashCustodyService.
    it('defaults staffId to the caller when omitted', async () => {
      prisma.meterReading.create.mockResolvedValue({ id: 'mr-1', nozzle: activeNozzle });

      await openShift({ nozzleId: 'n1' }, dsmCaller);

      expect(prisma.meterReading.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ staffId: 's1' }) }),
      );
    });

    it('rejects a DSM caller opening a shift assigned to a different staff member', async () => {
      await expect(
        openShift({ nozzleId: 'n1', staffId: 'other-staff' }, dsmCaller),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.meterReading.create).not.toHaveBeenCalled();
    });

    it('allows a non-DSM caller to open a shift assigned to a different staff member', async () => {
      prisma.meterReading.create.mockResolvedValue({ id: 'mr-1', nozzle: activeNozzle });

      await openShift({ nozzleId: 'n1', staffId: 'other-staff' }, managerCaller);

      expect(prisma.meterReading.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ staffId: 'other-staff' }) }),
      );
    });

    describe('backdating (shiftStart)', () => {
      it('rejects a DSM caller sending shiftStart at all', async () => {
        await expect(
          openShift({ nozzleId: 'n1', shiftStart: '2026-07-01T06:00:00.000Z' }, dsmCaller),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(prisma.meterReading.create).not.toHaveBeenCalled();
      });

      it('allows a non-DSM caller to backdate shiftStart', async () => {
        prisma.meterReading.create.mockResolvedValue({ id: 'mr-1', nozzle: activeNozzle });

        await openShift(
          { nozzleId: 'n1', staffId: 's1', shiftStart: '2026-07-01T06:00:00.000Z' },
          accountantCaller,
        );

        expect(prisma.meterReading.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ shiftStart: new Date('2026-07-01T06:00:00.000Z') }),
          }),
        );
      });

      it('rejects a future shiftStart', async () => {
        const future = new Date(Date.now() + 86_400_000).toISOString();

        await expect(
          openShift({ nozzleId: 'n1', staffId: 's1', shiftStart: future }, accountantCaller),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.meterReading.create).not.toHaveBeenCalled();
      });
    });
  });

  describe('closeShift', () => {
    const openShiftRow = {
      id: 'mr-1',
      nozzleId: 'n1',
      staffId: 's1',
      openingReading: 100,
      closingReading: null,
      shiftStart: new Date('2026-07-20T06:00:00Z'),
      shiftEnd: null,
      productType: 'petrol',
      meterRolledOver: false,
      nozzle: activeNozzle,
    };

    it('404s on an unknown id', async () => {
      prisma.meterReading.findUnique.mockResolvedValue(null);

      await expect(
        service.closeShift('nope', { closingReading: 150 }, dsmCaller),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('409s if the shift is already closed', async () => {
      prisma.meterReading.findUnique.mockResolvedValue({
        ...openShiftRow,
        closingReading: 150,
        shiftEnd: new Date(),
      });

      await expect(
        service.closeShift('mr-1', { closingReading: 200 }, dsmCaller),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('400s if closingReading is less than openingReading and meterRolledOver is not set', async () => {
      prisma.meterReading.findUnique.mockResolvedValue(openShiftRow);

      await expect(
        service.closeShift('mr-1', { closingReading: 50 }, dsmCaller),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('decrements the matching tank by litresSold and returns no tankWarning when a Tank matches', async () => {
      prisma.meterReading.findUnique.mockResolvedValue(openShiftRow);
      prisma.meterReading.update.mockResolvedValue({
        ...openShiftRow,
        closingReading: 150,
        shiftEnd: new Date(),
        nozzle: activeNozzle,
      });
      prisma.tank.findFirst.mockResolvedValue({
        id: 'tank-1',
        productType: 'petrol',
        currentStockLitres: 5000,
      });
      prisma.tank.update.mockResolvedValue({});

      const result = await service.closeShift('mr-1', { closingReading: 150 }, dsmCaller);

      expect(prisma.tank.findFirst).toHaveBeenCalledWith({
        where: { productType: 'petrol' },
      });
      expect(prisma.tank.update).toHaveBeenCalledWith({
        where: { id: 'tank-1' },
        data: { currentStockLitres: { decrement: 50 } }, // 150 - 100
      });
      expect(result).not.toHaveProperty('tankWarning');
      expect(result.litresSold).toBe(50);
    });

    it('returns tankWarning (does NOT block the close) when no Tank matches the productType', async () => {
      prisma.meterReading.findUnique.mockResolvedValue(openShiftRow);
      prisma.meterReading.update.mockResolvedValue({
        ...openShiftRow,
        closingReading: 150,
        shiftEnd: new Date(),
        nozzle: activeNozzle,
      });
      prisma.tank.findFirst.mockResolvedValue(null);

      const result = await service.closeShift('mr-1', { closingReading: 150 }, dsmCaller);

      expect(prisma.tank.update).not.toHaveBeenCalled();
      expect(prisma.meterReading.update).toHaveBeenCalled(); // the close itself still happened
      expect(result).toHaveProperty(
        'tankWarning',
        expect.stringContaining('No tank configured'),
      );
    });

    it('returns tankWarning (does NOT block the close) for a legacy shift with no productType', async () => {
      prisma.meterReading.findUnique.mockResolvedValue({
        ...openShiftRow,
        productType: null,
      });
      prisma.meterReading.update.mockResolvedValue({
        ...openShiftRow,
        productType: null,
        closingReading: 150,
        shiftEnd: new Date(),
        nozzle: activeNozzle,
      });

      const result = await service.closeShift('mr-1', { closingReading: 150 }, dsmCaller);

      expect(prisma.tank.findFirst).not.toHaveBeenCalled();
      expect(prisma.tank.update).not.toHaveBeenCalled();
      expect(result).toHaveProperty(
        'tankWarning',
        expect.stringContaining('legacy shift'),
      );
    });

    describe('meter rollover', () => {
      const rolloverNozzle = { ...activeNozzle, rolloverAt: 99999.99 };
      const rolloverOpenShift = { ...openShiftRow, openingReading: 99900, nozzle: rolloverNozzle };

      it('rejects meterRolledOver when the nozzle has no configured rolloverAt', async () => {
        prisma.meterReading.findUnique.mockResolvedValue(openShiftRow); // rolloverAt: null

        await expect(
          service.closeShift('mr-1', { closingReading: 50, meterRolledOver: true }, dsmCaller),
        ).rejects.toBeInstanceOf(BadRequestException);
      });

      it('rejects meterRolledOver when closingReading is not actually less than openingReading', async () => {
        prisma.meterReading.findUnique.mockResolvedValue(rolloverOpenShift);

        await expect(
          service.closeShift('mr-1', { closingReading: 99950, meterRolledOver: true }, dsmCaller),
        ).rejects.toBeInstanceOf(BadRequestException);
      });

      it('computes litresSold as (rolloverAt - opening) + closing when meterRolledOver is set and valid', async () => {
        prisma.meterReading.findUnique.mockResolvedValue(rolloverOpenShift);
        prisma.meterReading.update.mockResolvedValue({
          ...rolloverOpenShift,
          closingReading: 50,
          shiftEnd: new Date(),
          meterRolledOver: true,
        });
        prisma.tank.findFirst.mockResolvedValue(null); // tank matching not under test here

        const result = await service.closeShift(
          'mr-1',
          { closingReading: 50, meterRolledOver: true },
          dsmCaller,
        );

        // (99999.99 - 99900) + 50 = 149.99
        expect(result.litresSold).toBeCloseTo(149.99, 5);
      });
    });

    describe('backdating (shiftEnd)', () => {
      it('rejects a DSM caller sending shiftEnd at all', async () => {
        prisma.meterReading.findUnique.mockResolvedValue(openShiftRow);

        await expect(
          service.closeShift(
            'mr-1',
            { closingReading: 150, shiftEnd: '2026-07-20T18:00:00.000Z' },
            dsmCaller,
          ),
        ).rejects.toBeInstanceOf(ForbiddenException);
      });

      it('allows a non-DSM caller to backdate shiftEnd', async () => {
        prisma.meterReading.findUnique.mockResolvedValue(openShiftRow);
        prisma.meterReading.update.mockResolvedValue({
          ...openShiftRow,
          closingReading: 150,
          shiftEnd: new Date('2026-07-20T18:00:00.000Z'),
        });
        prisma.tank.findFirst.mockResolvedValue(null);

        await service.closeShift(
          'mr-1',
          { closingReading: 150, shiftEnd: '2026-07-20T18:00:00.000Z' },
          accountantCaller,
        );

        expect(prisma.meterReading.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ shiftEnd: new Date('2026-07-20T18:00:00.000Z') }),
          }),
        );
      });

      it('rejects a shiftEnd before this shift\'s shiftStart', async () => {
        prisma.meterReading.findUnique.mockResolvedValue(openShiftRow);

        await expect(
          service.closeShift(
            'mr-1',
            { closingReading: 150, shiftEnd: '2026-07-19T00:00:00.000Z' },
            accountantCaller,
          ),
        ).rejects.toBeInstanceOf(BadRequestException);
      });
    });
  });

  describe('correctMeterReading', () => {
    const firstEverReading = {
      id: 'mr-1',
      nozzleId: 'n1',
      staffId: 's1',
      openingReading: 100,
      closingReading: 150,
      shiftStart: new Date('2026-07-20T06:00:00Z'),
      shiftEnd: new Date('2026-07-20T14:00:00Z'),
      productType: 'petrol',
      meterRolledOver: false,
      nozzle: activeNozzle,
    };

    it('400s when neither field is provided', async () => {
      await expect(
        service.correctMeterReading('mr-1', {}, 'accountant-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('404s on an unknown id', async () => {
      prisma.meterReading.findUnique.mockResolvedValue(null);

      await expect(
        service.correctMeterReading('nope', { closingReading: 160 }, 'accountant-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects an openingReading correction when this is not the nozzle\'s first-ever shift', async () => {
      prisma.meterReading.findUnique.mockResolvedValue(firstEverReading);
      prisma.meterReading.findFirst.mockResolvedValueOnce({ id: 'earlier-shift' }); // an earlier reading exists

      await expect(
        service.correctMeterReading('mr-1', { openingReading: 90 }, 'accountant-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('allows an openingReading correction on the nozzle\'s first-ever shift', async () => {
      prisma.meterReading.findUnique.mockResolvedValue(firstEverReading);
      prisma.meterReading.findFirst.mockResolvedValueOnce(null); // no earlier reading
      prisma.meterReading.update.mockResolvedValue({ ...firstEverReading, openingReading: 90 });

      await service.correctMeterReading('mr-1', { openingReading: 90 }, 'accountant-1');

      expect(prisma.meterReading.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            openingReading: 90,
            correctedById: 'accountant-1',
          }),
        }),
      );
    });

    it('rejects a closingReading correction on a still-open shift', async () => {
      prisma.meterReading.findUnique.mockResolvedValue({ ...firstEverReading, closingReading: null });

      await expect(
        service.correctMeterReading('mr-1', { closingReading: 160 }, 'accountant-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('blocks a closingReading correction when a later shift on this nozzle is already closed too', async () => {
      prisma.meterReading.findUnique.mockResolvedValue(firstEverReading);
      prisma.meterReading.findFirst.mockResolvedValueOnce({ id: 'next-shift', closingReading: 300 });

      await expect(
        service.correctMeterReading('mr-1', { closingReading: 160 }, 'accountant-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.meterReading.update).not.toHaveBeenCalled();
    });

    it('adjusts tank stock by the litresSold delta and cascades openingReading to a still-open next shift', async () => {
      prisma.meterReading.findUnique.mockResolvedValue(firstEverReading);
      prisma.meterReading.findFirst.mockResolvedValueOnce({
        id: 'next-shift',
        closingReading: null, // still open
      });
      prisma.meterReading.update.mockResolvedValueOnce({ ...firstEverReading, closingReading: 160 });
      prisma.tank.findFirst.mockResolvedValue({ id: 'tank-1', productType: 'petrol', currentStockLitres: 5000 });

      await service.correctMeterReading('mr-1', { closingReading: 160 }, 'accountant-1');

      // old litresSold = 150-100=50, new = 160-100=60, delta=10
      expect(prisma.tank.update).toHaveBeenCalledWith({
        where: { id: 'tank-1' },
        data: { currentStockLitres: { decrement: 10 } },
      });
      expect(prisma.meterReading.update).toHaveBeenCalledWith({
        where: { id: 'next-shift' },
        data: { openingReading: 160 },
      });
    });
  });

  describe('checkVariance', () => {
    it('prefers an exact nozzleId match, falling back to staffId+time-window for bills without one', async () => {
      prisma.meterReading.findUnique.mockResolvedValue({
        id: 'mr-1',
        nozzleId: 'n1',
        staffId: 's1',
        openingReading: 100,
        closingReading: 150,
        shiftStart: new Date('2026-07-20T06:00:00Z'),
        shiftEnd: new Date('2026-07-20T14:00:00Z'),
        meterRolledOver: false,
        nozzle: activeNozzle,
      });
      prisma.bill.aggregate.mockResolvedValue({ _sum: { litres: 45 } });

      const result = await service.checkVariance('mr-1');

      expect(prisma.bill.aggregate).toHaveBeenCalledWith({
        _sum: { litres: true },
        where: {
          timestamp: { gte: expect.any(Date), lte: expect.any(Date) },
          deletedAt: null,
          OR: [{ nozzleId: 'n1' }, { nozzleId: null, enteredById: 's1' }],
        },
      });
      expect(result.litresSoldFromMeter).toBe(50);
      expect(result.litresBilled).toBe(45);
      expect(result.nozzleLabel).toBe('N1');
    });
  });

  describe('findAll', () => {
    it('with no staffId returns every reading (Owner/Accountant default)', async () => {
      await service.findAll();
      expect(prisma.meterReading.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: undefined }),
      );
    });

    // Security boundary — findAll(staffId) is what the controller uses to
    // force-scope a DSM caller to their own readings (see
    // meter-readings.controller.ts's findAll()); confirms the service half
    // of that guarantee actually filters rather than silently ignoring it.
    it('with a staffId filters to that staff member only', async () => {
      await service.findAll('s1');
      expect(prisma.meterReading.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { staffId: 's1' } }),
      );
    });
  });
});
