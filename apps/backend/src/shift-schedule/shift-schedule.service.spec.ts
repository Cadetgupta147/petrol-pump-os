import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ShiftScheduleService } from './shift-schedule.service';
import { PrismaService } from '../prisma/prisma.service';
import { runInTenantContext } from '../common/tenant-context';

// Meter Reading redesign (Section 3.3) — the shift schedule is a plain
// dealer-managed list (like Nozzle/Item), so most of its rule surface is
// covered directly by resolve-current-shift-window.spec.ts's date-math
// tests. This covers the CRUD/tenant-scoping wiring around it.
describe('ShiftScheduleService', () => {
  let service: ShiftScheduleService;

  let prisma: {
    shiftDefinition: { create: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      shiftDefinition: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ShiftScheduleService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(ShiftScheduleService);
  });

  function inTenant<T>(fn: () => Promise<T>) {
    return runInTenantContext({ pumpId: 'pump-1' }, fn);
  }

  describe('create', () => {
    it('stamps pumpId from the tenant context and trims the label', async () => {
      prisma.shiftDefinition.create.mockResolvedValue({
        id: 'sd1',
        pumpId: 'pump-1',
        label: 'Shift 1',
        startTime: '06:00',
        endTime: '14:00',
        isActive: true,
        createdAt: new Date(),
      });

      await inTenant(() =>
        service.create({ label: '  Shift 1  ', startTime: '06:00', endTime: '14:00' }),
      );

      expect(prisma.shiftDefinition.create).toHaveBeenCalledWith({
        data: {
          pumpId: 'pump-1',
          label: 'Shift 1',
          startTime: '06:00',
          endTime: '14:00',
        },
      });
    });
  });

  describe('findAll — includeInactive', () => {
    it('defaults to active-only', async () => {
      await service.findAll();
      expect(prisma.shiftDefinition.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true }, orderBy: { startTime: 'asc' } }),
      );
    });

    it('includeInactive=true drops the isActive filter (Settings re-enable flow)', async () => {
      await service.findAll(true);
      expect(prisma.shiftDefinition.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: undefined }),
      );
    });
  });

  describe('update', () => {
    it('404s on an unknown shift definition id', async () => {
      prisma.shiftDefinition.findUnique.mockResolvedValue(null);

      await expect(service.update('nope', { label: 'X' })).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.shiftDefinition.update).not.toHaveBeenCalled();
    });

    it('applies only the fields provided', async () => {
      prisma.shiftDefinition.findUnique.mockResolvedValue({
        id: 'sd1',
        label: 'Shift 1',
        startTime: '06:00',
        endTime: '14:00',
        isActive: true,
      });
      prisma.shiftDefinition.update.mockResolvedValue({ id: 'sd1', isActive: false });

      await service.update('sd1', { isActive: false });

      expect(prisma.shiftDefinition.update).toHaveBeenCalledWith({
        where: { id: 'sd1' },
        data: { isActive: false },
      });
    });
  });

  describe('findCurrent', () => {
    it('resolves against only the active shift definitions, at the given instant', async () => {
      prisma.shiftDefinition.findMany.mockResolvedValue([
        { id: 's1', label: 'Shift 1', startTime: '06:00', endTime: '14:00' },
      ]);

      const result = await service.findCurrent(new Date('2026-07-25T10:00:00'));

      expect(result?.shiftDefinition.id).toBe('s1');
    });

    it('returns null when nothing is configured, without throwing', async () => {
      prisma.shiftDefinition.findMany.mockResolvedValue([]);

      const result = await service.findCurrent(new Date('2026-07-25T10:00:00'));

      expect(result).toBeNull();
    });
  });
});
