import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ItemCategory, PaymentType } from '@prisma/client';
import { ItemSalesService } from './item-sales.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ItemSalesService', () => {
  let service: ItemSalesService;
  let prisma: {
    item: { findUnique: jest.Mock };
    lubricantItem: { findUnique: jest.Mock; update: jest.Mock };
    itemSale: { create: jest.Mock; findMany: jest.Mock };
    $transaction: jest.Mock;
  };

  const baseDto = {
    itemId: 'item-1',
    quantity: 2,
    unitPrice: 350,
    paymentType: PaymentType.CASH,
  };

  beforeEach(async () => {
    prisma = {
      item: { findUnique: jest.fn() },
      lubricantItem: { findUnique: jest.fn(), update: jest.fn() },
      itemSale: { create: jest.fn(), findMany: jest.fn() },
      $transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ItemSalesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(ItemSalesService);
  });

  it('404s on an unknown itemId', async () => {
    prisma.item.findUnique.mockResolvedValue(null);

    await expect(service.create(baseDto, 'staff-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.itemSale.create).not.toHaveBeenCalled();
  });

  it('rejects a FUEL-category item — fuel sales go through meter reading/billing', async () => {
    prisma.item.findUnique.mockResolvedValue({
      id: 'item-1',
      name: 'Petrol',
      category: ItemCategory.FUEL,
      pumpId: 'pump-1',
    });

    await expect(service.create(baseDto, 'staff-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.itemSale.create).not.toHaveBeenCalled();
  });

  describe('OTHER category (e.g. Urea/AdBlue) — no stock model, plain create', () => {
    it('computes amount server-side as quantity * unitPrice and records the sale with no stock effect', async () => {
      prisma.item.findUnique.mockResolvedValue({
        id: 'item-1',
        name: 'Urea/AdBlue',
        category: ItemCategory.OTHER,
        pumpId: 'pump-1',
      });
      prisma.itemSale.create.mockResolvedValue({ id: 'is-1' });

      const result = await service.create(baseDto, 'staff-1');

      expect(prisma.itemSale.create).toHaveBeenCalledWith({
        data: {
          pumpId: 'pump-1',
          itemId: 'item-1',
          quantity: 2,
          unitPrice: 350,
          amount: 700,
          paymentType: PaymentType.CASH,
          soldById: 'staff-1',
        },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.lubricantItem.update).not.toHaveBeenCalled();
      expect(result).toEqual({ id: 'is-1' });
    });
  });

  describe('LUBRICANT category — decrements linked stock', () => {
    it('404s when the item has no linked LubricantItem stock/pricing configured', async () => {
      prisma.item.findUnique.mockResolvedValue({
        id: 'item-1',
        name: 'Engine Oil 1L',
        category: ItemCategory.LUBRICANT,
        pumpId: 'pump-1',
      });
      prisma.lubricantItem.findUnique.mockResolvedValue(null);

      await expect(service.create(baseDto, 'staff-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects with 409 when requested quantity exceeds stock', async () => {
      prisma.item.findUnique.mockResolvedValue({
        id: 'item-1',
        name: 'Engine Oil 1L',
        category: ItemCategory.LUBRICANT,
        pumpId: 'pump-1',
      });
      prisma.lubricantItem.findUnique.mockResolvedValue({
        id: 'li-1',
        itemId: 'item-1',
        stockQty: 1,
      });

      await expect(service.create(baseDto, 'staff-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('creates the sale and decrements LubricantItem.stockQty in one transaction', async () => {
      prisma.item.findUnique.mockResolvedValue({
        id: 'item-1',
        name: 'Engine Oil 1L',
        category: ItemCategory.LUBRICANT,
        pumpId: 'pump-1',
      });
      prisma.lubricantItem.findUnique.mockResolvedValue({
        id: 'li-1',
        itemId: 'item-1',
        stockQty: 20,
      });
      const createdSale = { id: 'is-2' };
      prisma.$transaction.mockResolvedValue([createdSale, {}]);

      const result = await service.create(baseDto, 'staff-1');

      expect(prisma.itemSale.create).toHaveBeenCalledWith({
        data: {
          pumpId: 'pump-1',
          itemId: 'item-1',
          quantity: 2,
          unitPrice: 350,
          amount: 700,
          paymentType: PaymentType.CASH,
          soldById: 'staff-1',
        },
      });
      expect(prisma.lubricantItem.update).toHaveBeenCalledWith({
        where: { id: 'li-1' },
        data: { stockQty: { decrement: 2 } },
      });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(result).toEqual(createdSale);
    });
  });
});
