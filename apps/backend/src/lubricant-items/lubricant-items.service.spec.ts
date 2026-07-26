import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ItemCategory, Prisma } from '@prisma/client';
import { LubricantItemsService } from './lubricant-items.service';
import { PrismaService } from '../prisma/prisma.service';

describe('LubricantItemsService', () => {
  let service: LubricantItemsService;
  let prisma: {
    item: { findUnique: jest.Mock };
    lubricantItem: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };

  const baseDto = { itemId: 'item-1', salePrice: 350, stockQty: 20, reorderAt: 5 };

  beforeEach(async () => {
    prisma = {
      item: { findUnique: jest.fn() },
      lubricantItem: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LubricantItemsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(LubricantItemsService);
  });

  it('404s on an unknown itemId', async () => {
    prisma.item.findUnique.mockResolvedValue(null);

    await expect(service.create(baseDto)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.lubricantItem.create).not.toHaveBeenCalled();
  });

  it('rejects an item that is not category LUBRICANT', async () => {
    prisma.item.findUnique.mockResolvedValue({
      id: 'item-1',
      name: 'Urea/AdBlue',
      category: ItemCategory.OTHER,
      pumpId: 'pump-1',
    });

    await expect(service.create(baseDto)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.lubricantItem.create).not.toHaveBeenCalled();
  });

  it('creates the lubricant stock/pricing row, stamping pumpId from the matched Item', async () => {
    prisma.item.findUnique.mockResolvedValue({
      id: 'item-1',
      name: 'Engine Oil 1L',
      category: ItemCategory.LUBRICANT,
      pumpId: 'pump-1',
    });
    prisma.lubricantItem.create.mockResolvedValue({ id: 'li-1' });

    await service.create({ ...baseDto, sku: 'EO-1L', costPrice: 250 });

    expect(prisma.lubricantItem.create).toHaveBeenCalledWith({
      data: {
        pumpId: 'pump-1',
        itemId: 'item-1',
        sku: 'EO-1L',
        costPrice: 250,
        salePrice: 350,
        stockQty: 20,
        reorderAt: 5,
      },
    });
  });

  it('translates a duplicate itemId P2002 into a 400 (use PATCH instead)', async () => {
    prisma.item.findUnique.mockResolvedValue({
      id: 'item-1',
      name: 'Engine Oil 1L',
      category: ItemCategory.LUBRICANT,
      pumpId: 'pump-1',
    });
    prisma.lubricantItem.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique violation', {
        code: 'P2002',
        clientVersion: '6.19.3',
      }),
    );

    await expect(service.create(baseDto)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('findOne 404s on an unknown id', async () => {
    prisma.lubricantItem.findUnique.mockResolvedValue(null);
    await expect(service.findOne('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('update() applies only the fields provided', async () => {
    prisma.lubricantItem.findUnique.mockResolvedValue({ id: 'li-1', item: {} });
    prisma.lubricantItem.update.mockResolvedValue({ id: 'li-1', stockQty: 15 });

    await service.update('li-1', { stockQty: 15 });

    expect(prisma.lubricantItem.update).toHaveBeenCalledWith({
      where: { id: 'li-1' },
      data: { stockQty: 15 },
    });
  });
});
