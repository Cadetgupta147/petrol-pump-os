import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { GeneratorDieselService } from './generator-diesel.service';
import { PrismaService } from '../prisma/prisma.service';

describe('GeneratorDieselService', () => {
  let service: GeneratorDieselService;
  let prisma: {
    tank: { findUnique: jest.Mock; update: jest.Mock };
    generatorDieselLog: { create: jest.Mock; findMany: jest.Mock };
    $transaction: jest.Mock;
  };

  const baseDto = { tankId: 'tank-1', quantityLitres: 20, notes: 'weekly generator run' };

  beforeEach(async () => {
    prisma = {
      tank: { findUnique: jest.fn(), update: jest.fn() },
      generatorDieselLog: { create: jest.fn(), findMany: jest.fn() },
      $transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GeneratorDieselService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(GeneratorDieselService);
  });

  it('404s on an unknown tankId and never opens a transaction', async () => {
    prisma.tank.findUnique.mockResolvedValue(null);

    await expect(service.create(baseDto, 'staff-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('creates the log and decrements the matched tank by quantityLitres, in one transaction', async () => {
    const tank = { id: 'tank-1', pumpId: 'pump-1', currentStockLitres: 5000 };
    prisma.tank.findUnique.mockResolvedValue(tank);
    const createdLog = { id: 'gdl-1', ...baseDto };
    prisma.$transaction.mockResolvedValue([createdLog, {}]);

    const result = await service.create(baseDto, 'staff-1');

    expect(prisma.generatorDieselLog.create).toHaveBeenCalledWith({
      data: {
        pumpId: 'pump-1',
        tankId: 'tank-1',
        quantityLitres: 20,
        recordedById: 'staff-1',
        notes: 'weekly generator run',
      },
    });
    expect(prisma.tank.update).toHaveBeenCalledWith({
      where: { id: 'tank-1' },
      data: { currentStockLitres: { decrement: 20 } },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(result).toEqual(createdLog);
  });

  it('does not clamp/reject when the decrement would take stock below zero (variance report is the intended catch)', async () => {
    prisma.tank.findUnique.mockResolvedValue({ id: 'tank-1', pumpId: 'pump-1', currentStockLitres: 5 });
    prisma.$transaction.mockResolvedValue([{ id: 'gdl-1' }, {}]);

    await expect(service.create(baseDto, 'staff-1')).resolves.toBeDefined();
    expect(prisma.tank.update).toHaveBeenCalledWith({
      where: { id: 'tank-1' },
      data: { currentStockLitres: { decrement: 20 } },
    });
  });
});
