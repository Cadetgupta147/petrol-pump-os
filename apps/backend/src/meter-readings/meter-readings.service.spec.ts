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

const activeNozzle = {
  id: 'n1',
  pumpId: 'pump-1',
  label: 'N1',
  productType: 'petrol',
  startingReading: 100,
  isActive: true,
  createdAt: new Date(),
};

// Section 3.3 (pre-existing) + Section 7.2 step 2 (tank auto-deduction on
// shift close) + Section 3.3/4 Nozzle master carry-forward (this slice):
// openShift() no longer accepts openingReading/productType from the client
// at all — both are derived from the Nozzle master and the carry-forward
// rule (this nozzle's last closed shift's closingReading, or
// Nozzle.startingReading if it's never had one). That's the rule-heavy
// behavior this file focuses new coverage on; checkVariance's litres-billed
// approximation etc. remain out of scope here, as before.
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
    nozzle: { findUnique: jest.Mock };
    tank: { findFirst: jest.Mock; update: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      meterReading: {
        findFirst: jest.fn().mockResolvedValue(null), // no open shift / no prior closed shift by default
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      nozzle: { findUnique: jest.fn().mockResolvedValue(activeNozzle) },
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

  // Phase 0.3 (docs/multi-tenancy-plan.md) — openShift() now reads
  // requireTenantContext().pumpId directly (not just via
  // resolveAssignableActorId's user param); every call site needs an
  // active tenant context.
  function openShift(dto: OpenShiftDto, user: AuthenticatedUser) {
    return runInTenantContext({ pumpId: 'pump-1' }, () => service.openShift(dto, user));
  }

  describe('openShift', () => {
    it('derives openingReading (from Nozzle.startingReading) and productType (from the Nozzle) — never from the request body', async () => {
      prisma.meterReading.create.mockResolvedValue({
        id: 'mr-1',
        nozzleId: 'n1',
        staffId: 's1',
        openingReading: 100,
        closingReading: null,
        shiftStart: new Date(),
        shiftEnd: null,
        productType: 'petrol',
        nozzle: activeNozzle,
      });

      await openShift({ nozzleId: 'n1', staffId: 's1' }, dsmCaller);

      expect(prisma.meterReading.create).toHaveBeenCalledWith({
        data: {
          pumpId: 'pump-1',
          nozzleId: 'n1',
          staffId: 's1',
          openingReading: 100, // == activeNozzle.startingReading — no prior closed shift
          productType: 'petrol',
        },
        include: { nozzle: true },
      });
    });

    it("carries forward the nozzle's last closed shift's closingReading as the new shift's openingReading", async () => {
      // First findFirst call = the "already has an open shift?" check (none);
      // second = resolveOpeningReading()'s "last closed shift" lookup.
      prisma.meterReading.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ closingReading: 5000 });
      prisma.meterReading.create.mockResolvedValue({ id: 'mr-2' });

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

    // Finding A1 (docs/production-readiness.md) — resolveAssignableActorId()
    // coverage, same pattern as AttendanceService/CashCustodyService.
    it('defaults staffId to the caller when omitted', async () => {
      prisma.meterReading.create.mockResolvedValue({ id: 'mr-1' });

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
      prisma.meterReading.create.mockResolvedValue({ id: 'mr-1' });

      await openShift({ nozzleId: 'n1', staffId: 'other-staff' }, managerCaller);

      expect(prisma.meterReading.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ staffId: 'other-staff' }) }),
      );
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
    };

    it('404s on an unknown id', async () => {
      prisma.meterReading.findUnique.mockResolvedValue(null);

      await expect(
        service.closeShift('nope', { closingReading: 150 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('409s if the shift is already closed', async () => {
      prisma.meterReading.findUnique.mockResolvedValue({
        ...openShiftRow,
        closingReading: 150,
        shiftEnd: new Date(),
      });

      await expect(
        service.closeShift('mr-1', { closingReading: 200 }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('400s if closingReading is less than openingReading', async () => {
      prisma.meterReading.findUnique.mockResolvedValue(openShiftRow);

      await expect(
        service.closeShift('mr-1', { closingReading: 50 }),
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
      prisma.meterReading.findUnique.mockResolvedValue(openShiftRow);
      prisma.meterReading.update.mockResolvedValue({
        ...openShiftRow,
        closingReading: 150,
        shiftEnd: new Date(),
        nozzle: activeNozzle,
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
