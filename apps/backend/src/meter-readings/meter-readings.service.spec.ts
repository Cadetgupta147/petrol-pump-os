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
import type { BatchCloseDto } from './dto/batch-close.dto';

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
    shiftSalesSummary: { findFirst: jest.Mock };
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
      shiftSalesSummary: { findFirst: jest.fn().mockResolvedValue(null) }, // no walk-in reconciliation logged by default
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

  function batchClose(dto: BatchCloseDto, user: AuthenticatedUser) {
    return runInTenantContext({ pumpId: 'pump-1' }, () => service.batchClose(dto, user));
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
        include: { nozzle: { include: { item: true } } },
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
    function mockReading(overrides: Record<string, unknown> = {}) {
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
        ...overrides,
      });
    }

    it('prefers an exact nozzleId match, falling back to staffId+time-window for bills without one', async () => {
      mockReading();
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

    // Section 8A.2 fix — a positive gap (meter shows more than was billed)
    // is expected on any pump with real walk-in cash trade, not itself
    // fraud. See ShiftSalesSummary.walkInLitres, which computes this exact
    // same gap independently once a shift's walk-in sales are reconciled.
    it('does not flag a positive gap as fraud when no walk-in reconciliation exists yet — surfaces it as pending instead', async () => {
      mockReading(); // litresSoldFromMeter 50, litresBilled 45 -> rawGap 5
      prisma.bill.aggregate.mockResolvedValue({ _sum: { litres: 45 } });
      // shiftSalesSummary.findFirst already defaults to null in beforeEach.

      const result = await service.checkVariance('mr-1');

      expect(result.variance).toBe(5);
      expect(result.walkInLitresReconciled).toBeNull();
      expect(result.flagged).toBe(false);
      expect(result.reconciliationPending).toBe(true);
    });

    it('does not mark reconciliation pending when the raw gap is already within tolerance', async () => {
      mockReading(); // litresSoldFromMeter 50
      prisma.bill.aggregate.mockResolvedValue({ _sum: { litres: 49.8 } }); // rawGap 0.2, within the 0.5L tolerance

      const result = await service.checkVariance('mr-1');

      expect(result.flagged).toBe(false);
      expect(result.reconciliationPending).toBe(false);
    });

    it('nets out ShiftSalesSummary.walkInLitres before flagging once walk-in sales are reconciled', async () => {
      mockReading(); // litresSoldFromMeter 50
      prisma.bill.aggregate.mockResolvedValue({ _sum: { litres: 20 } }); // rawGap 30
      prisma.shiftSalesSummary.findFirst.mockResolvedValue({ id: 'sss-1', walkInLitres: 30 });

      const result = await service.checkVariance('mr-1');

      expect(prisma.shiftSalesSummary.findFirst).toHaveBeenCalledWith({ where: { shiftId: 'mr-1' } });
      expect(result.walkInLitresReconciled).toBe(30);
      expect(result.variance).toBe(0); // fully explained by the reconciled walk-in figure
      expect(result.flagged).toBe(false);
      expect(result.reconciliationPending).toBe(false);
    });

    it('still flags a genuine leftover after netting out a reconciled walk-in figure', async () => {
      mockReading(); // litresSoldFromMeter 50
      prisma.bill.aggregate.mockResolvedValue({ _sum: { litres: 10 } }); // rawGap 40
      prisma.shiftSalesSummary.findFirst.mockResolvedValue({ id: 'sss-1', walkInLitres: 30 }); // only explains 30 of the 40

      const result = await service.checkVariance('mr-1');

      expect(result.variance).toBe(10); // 40 - 30, still unexplained
      expect(result.flagged).toBe(true);
      expect(result.reconciliationPending).toBe(false);
    });

    it('always flags a negative gap (billed more than the meter shows dispensed), reconciled or not — walk-in can never explain that direction', async () => {
      mockReading(); // litresSoldFromMeter 50
      prisma.bill.aggregate.mockResolvedValue({ _sum: { litres: 70 } }); // rawGap -20

      const result = await service.checkVariance('mr-1');

      expect(result.variance).toBe(-20);
      expect(result.walkInLitresReconciled).toBeNull();
      expect(result.flagged).toBe(true);
      expect(result.reconciliationPending).toBe(false);
      // Never even needs to check for a walk-in summary — that direction of
      // gap isn't something walk-in reconciliation could explain anyway.
      expect(prisma.shiftSalesSummary.findFirst).not.toHaveBeenCalled();
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

  // Meter Reading redesign (Section 3.3) — replaces the two-step "Open
  // Shift" then "Close Shift" DSM flow with one batch submission covering
  // every nozzle at once. Everything here runs inside the shared
  // $transaction mock (`cb(prisma)` — see beforeEach above), so `tx` and
  // `this.prisma` are the same mock object in these tests.
  describe('batchClose', () => {
    const openReading = {
      id: 'mr-open',
      nozzleId: 'n1',
      staffId: 's1',
      openingReading: 100,
      closingReading: null,
      shiftStart: new Date(Date.now() - 60 * 60 * 1000), // an hour ago — always before "now"
      shiftEnd: null,
      meterRolledOver: false,
      productType: 'petrol',
      nozzle: activeNozzle,
    };

    it('auto-creates then closes a nozzle with no open shift, and auto-reopens the next shift carrying the closing reading forward', async () => {
      prisma.meterReading.findFirst
        .mockResolvedValueOnce(null) // "does this nozzle have an open shift?" — no
        .mockResolvedValueOnce(null); // resolveOpeningReading()'s "last closed shift" lookup — none, falls back to startingReading
      prisma.meterReading.create
        .mockResolvedValueOnce({ ...openReading, id: 'mr-auto-opened' }) // the auto-opened shift
        .mockResolvedValueOnce({ id: 'mr-reopened' }); // the auto-reopen after closing
      prisma.meterReading.update.mockResolvedValue({
        ...openReading,
        id: 'mr-auto-opened',
        closingReading: 150,
      });
      prisma.tank.findFirst.mockResolvedValue({ id: 'tank-1', currentStockLitres: 1000 });

      const dto: BatchCloseDto = { readings: [{ nozzleId: 'n1', closingReading: 150 }] };
      const [result] = await batchClose(dto, dsmCaller);

      expect(result.litresSold).toBe(50); // 150 - 100
      expect(result.tankWarning).toBeUndefined();

      // First create() opened the shift (carry-forward opening = startingReading, no prior closed shift)
      expect(prisma.meterReading.create).toHaveBeenNthCalledWith(1, {
        data: {
          pumpId: 'pump-1',
          nozzleId: 'n1',
          openLockNozzleId: 'n1',
          staffId: 's1',
          openingReading: 100,
          productType: 'petrol',
        },
        include: { nozzle: { include: { item: true } } },
      });
      // Second create() auto-reopens the next shift, carrying the just-submitted closing forward.
      expect(prisma.meterReading.create).toHaveBeenNthCalledWith(2, {
        data: {
          pumpId: 'pump-1',
          nozzleId: 'n1',
          openLockNozzleId: 'n1',
          staffId: 's1',
          openingReading: 150,
          productType: 'petrol',
        },
      });
      expect(prisma.tank.update).toHaveBeenCalledWith({
        where: { id: 'tank-1' },
        data: { currentStockLitres: { decrement: 50 } },
      });
    });

    it('closes an already-open shift directly, without auto-creating one first', async () => {
      prisma.meterReading.findFirst.mockResolvedValueOnce(openReading);
      prisma.meterReading.create.mockResolvedValue({ id: 'mr-reopened' });
      prisma.meterReading.update.mockResolvedValue({ ...openReading, closingReading: 150 });
      prisma.tank.findFirst.mockResolvedValue({ id: 'tank-1' });

      await batchClose({ readings: [{ nozzleId: 'n1', closingReading: 150 }] }, dsmCaller);

      // Only the auto-REOPEN create() should fire — no auto-open, since a
      // shift was already open and found on the first findFirst() lookup.
      expect(prisma.meterReading.create).toHaveBeenCalledTimes(1);
      expect(prisma.meterReading.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'mr-open' } }),
      );
    });

    it('resolves staffId independently per nozzle row — a non-DSM caller may assign a different staffId per row', async () => {
      const nozzle2 = { ...activeNozzle, id: 'n2', label: 'N2' };
      prisma.nozzle.findUnique
        .mockResolvedValueOnce(activeNozzle)
        .mockResolvedValueOnce(nozzle2);
      prisma.meterReading.findFirst.mockResolvedValue(null); // no open shift, no prior closed shift, for either nozzle
      prisma.meterReading.create.mockImplementation((args: { data: { nozzleId: string; staffId: string } }) =>
        Promise.resolve({ ...openReading, id: `mr-${args.data.nozzleId}`, staffId: args.data.staffId, nozzle: args.data.nozzleId === 'n1' ? activeNozzle : nozzle2 }),
      );
      prisma.meterReading.update.mockImplementation((args: { where: { id: string } }) =>
        Promise.resolve({ ...openReading, ...args.where, closingReading: 150, nozzle: activeNozzle }),
      );
      prisma.tank.findFirst.mockResolvedValue(null); // no tank configured — tankWarning path, irrelevant here

      const dto: BatchCloseDto = {
        readings: [
          { nozzleId: 'n1', closingReading: 150, staffId: 'staff-A' },
          { nozzleId: 'n2', closingReading: 150, staffId: 'staff-B' },
        ],
      };
      await batchClose(dto, accountantCaller);

      // Call order: n1's auto-open, n1's auto-reopen, n2's auto-open, n2's
      // auto-reopen — each nozzle's pair carries its OWN resolved staffId,
      // not whichever staffId a different row in the same batch used.
      const calls = prisma.meterReading.create.mock.calls as Array<[{ data: { staffId: string } }]>;
      expect(calls[0][0].data.staffId).toBe('staff-A');
      expect(calls[1][0].data.staffId).toBe('staff-A');
      expect(calls[2][0].data.staffId).toBe('staff-B');
      expect(calls[3][0].data.staffId).toBe('staff-B');
    });

    it('rejects a DSM caller attributing a different nozzle row to someone else, aborting the whole batch', async () => {
      const dto: BatchCloseDto = {
        readings: [{ nozzleId: 'n1', closingReading: 150, staffId: 'someone-else' }],
      };
      await expect(batchClose(dto, dsmCaller)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.meterReading.create).not.toHaveBeenCalled();
      expect(prisma.meterReading.update).not.toHaveBeenCalled();
    });

    it('aborts the whole batch when any single row fails validation (closingReading < opening without meterRolledOver)', async () => {
      prisma.meterReading.findFirst.mockResolvedValueOnce(openReading);

      const dto: BatchCloseDto = {
        readings: [{ nozzleId: 'n1', closingReading: 50 }], // < openingReading (100), no meterRolledOver
      };
      await expect(batchClose(dto, dsmCaller)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.meterReading.update).not.toHaveBeenCalled();
    });

    it('404s when a submitted nozzleId does not exist', async () => {
      prisma.nozzle.findUnique.mockResolvedValueOnce(null);

      const dto: BatchCloseDto = { readings: [{ nozzleId: 'does-not-exist', closingReading: 150 }] };
      await expect(batchClose(dto, dsmCaller)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
