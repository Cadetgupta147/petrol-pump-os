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

// Section 3.3 (pre-existing, previously untested — this file closes that
// pre-existing gap, per the task spec) + Section 7.2 step 2 (tank
// auto-deduction on shift close, added by this slice). Covers only what this
// slice touches: openShift's new productType field, and closeShift's tank
// auto-deduction / tankWarning behavior. Section 3.3's other pre-existing
// behavior (checkVariance's litres-billed approximation, etc.) is left
// uncovered here — out of scope for this task, flagged, not silently
// expanded beyond what was asked.
describe('MeterReadingsService', () => {
  let service: MeterReadingsService;

  type TxCallback = (tx: unknown) => Promise<unknown>;

  let prisma: {
    meterReading: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    tank: { findFirst: jest.Mock; update: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      meterReading: {
        findFirst: jest.fn().mockResolvedValue(null), // no open shift by default
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      tank: { findFirst: jest.fn(), update: jest.fn() },
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

  describe('openShift', () => {
    it('persists productType on the MeterReading row', async () => {
      prisma.meterReading.create.mockResolvedValue({
        id: 'mr-1',
        nozzleId: 'n1',
        staffId: 's1',
        openingReading: 100,
        closingReading: null,
        shiftStart: new Date(),
        shiftEnd: null,
        productType: 'petrol',
      });

      await service.openShift(
        {
          nozzleId: 'n1',
          staffId: 's1',
          openingReading: 100,
          productType: 'petrol',
        },
        dsmCaller,
      );

      expect(prisma.meterReading.create).toHaveBeenCalledWith({
        data: {
          nozzleId: 'n1',
          staffId: 's1',
          openingReading: 100,
          productType: 'petrol',
        },
      });
    });

    // Finding A1 (docs/production-readiness.md) — resolveAssignableActorId()
    // coverage, same pattern as AttendanceService/CashCustodyService.
    it('defaults staffId to the caller when omitted', async () => {
      prisma.meterReading.create.mockResolvedValue({ id: 'mr-1' });

      await service.openShift(
        { nozzleId: 'n1', openingReading: 100, productType: 'petrol' },
        dsmCaller,
      );

      expect(prisma.meterReading.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ staffId: 's1' }) }),
      );
    });

    it('rejects a DSM caller opening a shift assigned to a different staff member', async () => {
      await expect(
        service.openShift(
          { nozzleId: 'n1', staffId: 'other-staff', openingReading: 100, productType: 'petrol' },
          dsmCaller,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.meterReading.create).not.toHaveBeenCalled();
    });

    it('allows a non-DSM caller to open a shift assigned to a different staff member', async () => {
      prisma.meterReading.create.mockResolvedValue({ id: 'mr-1' });

      await service.openShift(
        { nozzleId: 'n1', staffId: 'other-staff', openingReading: 100, productType: 'petrol' },
        managerCaller,
      );

      expect(prisma.meterReading.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ staffId: 'other-staff' }) }),
      );
    });
  });

  describe('closeShift', () => {
    const openShift = {
      id: 'mr-1',
      nozzleId: 'n1',
      staffId: 's1',
      openingReading: 100,
      closingReading: null,
      shiftStart: new Date('2026-07-20T06:00:00Z'),
      shiftEnd: null,
      productType: 'petrol',
    };

    it('404s on an unknown id', async () => {
      prisma.meterReading.findUnique.mockResolvedValue(null);

      await expect(
        service.closeShift('nope', { closingReading: 150 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('409s if the shift is already closed', async () => {
      prisma.meterReading.findUnique.mockResolvedValue({
        ...openShift,
        closingReading: 150,
        shiftEnd: new Date(),
      });

      await expect(
        service.closeShift('mr-1', { closingReading: 200 }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('400s if closingReading is less than openingReading', async () => {
      prisma.meterReading.findUnique.mockResolvedValue(openShift);

      await expect(
        service.closeShift('mr-1', { closingReading: 50 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('decrements the matching tank by litresSold and returns no tankWarning when a Tank matches', async () => {
      prisma.meterReading.findUnique.mockResolvedValue(openShift);
      prisma.meterReading.update.mockResolvedValue({
        ...openShift,
        closingReading: 150,
        shiftEnd: new Date(),
      });
      prisma.tank.findFirst.mockResolvedValue({
        id: 'tank-1',
        productType: 'petrol',
        currentStockLitres: 5000,
      });
      prisma.tank.update.mockResolvedValue({});

      const result = await service.closeShift('mr-1', { closingReading: 150 });

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
      prisma.meterReading.findUnique.mockResolvedValue(openShift);
      prisma.meterReading.update.mockResolvedValue({
        ...openShift,
        closingReading: 150,
        shiftEnd: new Date(),
      });
      prisma.tank.findFirst.mockResolvedValue(null);

      const result = await service.closeShift('mr-1', { closingReading: 150 });

      expect(prisma.tank.update).not.toHaveBeenCalled();
      expect(prisma.meterReading.update).toHaveBeenCalled(); // the close itself still happened
      expect(result).toHaveProperty(
        'tankWarning',
        expect.stringContaining('No tank configured'),
      );
    });

    it('returns tankWarning (does NOT block the close) for a legacy shift with no productType', async () => {
      prisma.meterReading.findUnique.mockResolvedValue({
        ...openShift,
        productType: null,
      });
      prisma.meterReading.update.mockResolvedValue({
        ...openShift,
        productType: null,
        closingReading: 150,
        shiftEnd: new Date(),
      });

      const result = await service.closeShift('mr-1', { closingReading: 150 });

      expect(prisma.tank.findFirst).not.toHaveBeenCalled();
      expect(prisma.tank.update).not.toHaveBeenCalled();
      expect(result).toHaveProperty(
        'tankWarning',
        expect.stringContaining('legacy shift'),
      );
    });
  });
});
