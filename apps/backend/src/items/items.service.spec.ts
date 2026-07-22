import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ItemCategory, ItemUnit, Prisma } from '@prisma/client';
import { ItemsService } from './items.service';
import { PrismaService } from '../prisma/prisma.service';
import { runInTenantContext } from '../common/tenant-context';

describe('ItemsService', () => {
  let service: ItemsService;

  let prisma: {
    item: { create: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      item: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ItemsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(ItemsService);
  });

  function inTenant<T>(fn: () => Promise<T>) {
    return runInTenantContext({ pumpId: 'pump-1' }, fn);
  }

  it('stamps pumpId from the tenant context on create', async () => {
    prisma.item.create.mockResolvedValue({ id: 'i1' });

    await inTenant(() =>
      service.create({ name: 'Petrol', category: ItemCategory.FUEL, unit: ItemUnit.LITRE }),
    );

    expect(prisma.item.create).toHaveBeenCalledWith({
      data: { pumpId: 'pump-1', name: 'Petrol', category: ItemCategory.FUEL, unit: ItemUnit.LITRE },
    });
  });

  it('findAll() defaults to active-only', async () => {
    await service.findAll();
    expect(prisma.item.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  });

  it('findAll(true) includes inactive items (for the Settings re-enable flow)', async () => {
    await service.findAll(true);
    expect(prisma.item.findMany).toHaveBeenCalledWith({
      where: undefined,
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  });

  it('404s on an unknown id', async () => {
    prisma.item.findUnique.mockResolvedValue(null);
    await expect(service.findOne('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('translates a duplicate-name P2002 into a 400', async () => {
    prisma.item.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique violation', {
        code: 'P2002',
        clientVersion: '6.19.3',
      }),
    );

    await expect(
      inTenant(() => service.create({ name: 'Petrol', category: ItemCategory.FUEL, unit: ItemUnit.LITRE })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows updating name/category/unit/isActive independently', async () => {
    prisma.item.findUnique.mockResolvedValue({ id: 'i1', name: 'Petrol' });
    prisma.item.update.mockResolvedValue({ id: 'i1', isActive: false });

    await service.update('i1', { isActive: false });

    expect(prisma.item.update).toHaveBeenCalledWith({
      where: { id: 'i1' },
      data: { isActive: false },
    });
  });
});
