import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MachineTestingService } from './machine-testing.service';
import { PrismaService } from '../prisma/prisma.service';

describe('MachineTestingService', () => {
  let service: MachineTestingService;
  let prisma: {
    tank: { findUnique: jest.Mock; update: jest.Mock };
    machineTestingLog: { create: jest.Mock; findMany: jest.Mock };
    $transaction: jest.Mock;
  };

  const baseDto = { tankId: 'tank-1', result: 'Pass' };

  beforeEach(async () => {
    prisma = {
      tank: { findUnique: jest.fn(), update: jest.fn() },
      machineTestingLog: { create: jest.fn(), findMany: jest.fn() },
      $transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MachineTestingService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(MachineTestingService);
  });

  it('404s on an unknown tankId and never touches the log or the tank', async () => {
    prisma.tank.findUnique.mockResolvedValue(null);

    await expect(service.create(baseDto, 'staff-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.machineTestingLog.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('creates a plain log with litresDrawnOff defaulting to 0, and does NOT touch Tank stock, when litresDrawnOff is omitted', async () => {
    prisma.tank.findUnique.mockResolvedValue({ id: 'tank-1', pumpId: 'pump-1' });
    prisma.machineTestingLog.create.mockResolvedValue({ id: 'mtl-1' });

    const result = await service.create(baseDto, 'staff-1');

    expect(prisma.machineTestingLog.create).toHaveBeenCalledWith({
      data: {
        pumpId: 'pump-1',
        tankId: 'tank-1',
        litresDrawnOff: 0,
        result: 'Pass',
        deviationFound: undefined,
        calibrationChartRef: undefined,
        performedById: 'staff-1',
        notes: undefined,
      },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.tank.update).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 'mtl-1' });
  });

  it('decrements the matched tank in the same transaction when litresDrawnOff > 0', async () => {
    prisma.tank.findUnique.mockResolvedValue({ id: 'tank-1', pumpId: 'pump-1' });
    const createdLog = { id: 'mtl-2' };
    prisma.$transaction.mockResolvedValue([createdLog, {}]);

    const result = await service.create(
      { ...baseDto, litresDrawnOff: 5, deviationFound: 0.02, calibrationChartRef: 'chart-2026-07.pdf' },
      'staff-1',
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.machineTestingLog.create).toHaveBeenCalledWith({
      data: {
        pumpId: 'pump-1',
        tankId: 'tank-1',
        litresDrawnOff: 5,
        result: 'Pass',
        deviationFound: 0.02,
        calibrationChartRef: 'chart-2026-07.pdf',
        performedById: 'staff-1',
        notes: undefined,
      },
    });
    expect(prisma.tank.update).toHaveBeenCalledWith({
      where: { id: 'tank-1' },
      data: { currentStockLitres: { decrement: 5 } },
    });
    expect(result).toEqual(createdLog);
  });
});
