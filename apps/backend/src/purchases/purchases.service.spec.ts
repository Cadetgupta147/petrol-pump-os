import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PurchasesService } from './purchases.service';
import { PrismaService } from '../prisma/prisma.service';

// Section 7.1/7.2 — manual purchase entry increments the matching tank in
// the same transaction, and hard-rejects when no Tank exists for the stated
// productType (the deliberate asymmetry vs. closeShift()'s soft warning —
// see purchases.service.ts's comment, exercised on the meter-readings side
// in meter-readings.service.spec.ts).
describe('PurchasesService', () => {
  let service: PurchasesService;
  let prisma: {
    tank: { findFirst: jest.Mock; update: jest.Mock };
    purchaseEntry: { create: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock };
    $transaction: jest.Mock;
  };

  const baseDto = {
    supplierName: 'IOCL Depot',
    productType: 'petrol',
    quantityLitres: 1000,
    amount: 95000,
    ratePerLitre: 95,
    invoiceNo: 'INV-001',
    tankerNo: 'TN-01',
  };

  beforeEach(async () => {
    prisma = {
      tank: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      purchaseEntry: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchasesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(PurchasesService);
  });

  it('rejects when no Tank exists for the stated productType (hard block, not a warning)', async () => {
    prisma.tank.findFirst.mockResolvedValue(null);

    await expect(service.create(baseDto)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('creates the PurchaseEntry with ocrExtracted defaulting to false when omitted, and increments the matched tank by quantityLitres, in one transaction', async () => {
    const tank = { id: 'tank-1', productType: 'petrol', currentStockLitres: 5000 };
    prisma.tank.findFirst.mockResolvedValue(tank);
    const createdEntry = { id: 'pe-1', ...baseDto, ocrExtracted: false };
    prisma.$transaction.mockResolvedValue([createdEntry, {}]);

    const result = await service.create(baseDto);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.purchaseEntry.create).toHaveBeenCalledWith({
      data: {
        supplierName: baseDto.supplierName,
        productType: baseDto.productType,
        quantityLitres: baseDto.quantityLitres,
        amount: baseDto.amount,
        ratePerLitre: baseDto.ratePerLitre,
        invoiceNo: baseDto.invoiceNo,
        tankerNo: baseDto.tankerNo,
        invoiceImageUrl: undefined,
        ocrExtracted: false,
      },
    });
    expect(prisma.tank.update).toHaveBeenCalledWith({
      where: { id: 'tank-1' },
      data: { currentStockLitres: { increment: baseDto.quantityLitres } },
    });
    expect(result).toEqual(createdEntry);
  });

  it('persists ocrExtracted: true when the client sends it (Section 9 provenance metadata)', async () => {
    prisma.tank.findFirst.mockResolvedValue({ id: 'tank-1', productType: 'petrol' });
    prisma.$transaction.mockResolvedValue([{ id: 'pe-2' }, {}]);

    await service.create({ ...baseDto, ocrExtracted: true });

    const calls = prisma.purchaseEntry.create.mock.calls as Array<
      [{ data: { ocrExtracted: boolean } }]
    >;
    expect(calls[0][0].data.ocrExtracted).toBe(true);
  });

  it('matches Tank by exact productType string equality', async () => {
    prisma.tank.findFirst.mockResolvedValue({
      id: 'tank-1',
      productType: 'petrol',
    });
    prisma.$transaction.mockResolvedValue([{ id: 'pe-1' }, {}]);

    await service.create(baseDto);

    expect(prisma.tank.findFirst).toHaveBeenCalledWith({
      where: { productType: 'petrol' },
    });
  });

  it('findOne 404s on an unknown id', async () => {
    prisma.purchaseEntry.findUnique.mockResolvedValue(null);

    await expect(service.findOne('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
