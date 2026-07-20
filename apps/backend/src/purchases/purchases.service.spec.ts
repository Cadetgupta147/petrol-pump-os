import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PurchasesService } from './purchases.service';
import { PrismaService } from '../prisma/prisma.service';

// Section 7.1/7.2 — manual purchase entry increments the matching tank in
// the same transaction, and hard-rejects when no Tank exists for the stated
// productType (the deliberate asymmetry vs. closeShift()'s soft warning —
// see purchases.service.ts's comment, exercised on the meter-readings side
// in meter-readings.service.spec.ts).
// Section 7.3 — optional linked DensityLog creation, same transaction.
describe('PurchasesService', () => {
  let service: PurchasesService;
  let prisma: {
    tank: { findFirst: jest.Mock; update: jest.Mock };
    purchaseEntry: { create: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock };
    densityLog: { create: jest.Mock };
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
      densityLog: { create: jest.fn() },
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
        id: expect.any(String) as unknown,
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
    // No densityValue supplied — no DensityLog operation joins the
    // transaction.
    expect(prisma.densityLog.create).not.toHaveBeenCalled();
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

  describe('Section 7.3 density linkage', () => {
    it('rejects densityValue without recordedById, before touching the DB', async () => {
      await expect(
        service.create({ ...baseDto, densityValue: 0.75 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.tank.findFirst).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('creates a linked DensityLog in the same transaction when densityValue is provided, flagged via computeDensityFlag', async () => {
      const tank = { id: 'tank-1', productType: 'petrol' };
      prisma.tank.findFirst.mockResolvedValue(tank);
      const createdEntry = { id: 'pe-1', ...baseDto };
      prisma.$transaction.mockResolvedValue([createdEntry, {}, {}]);

      await service.create({
        ...baseDto,
        densityValue: 0.5, // below the MS range -> flagged
        ppmValue: 12,
        recordedById: 'staff-1',
      });

      expect(prisma.densityLog.create).toHaveBeenCalledWith({
        data: {
          tankId: 'tank-1',
          densityValue: 0.5,
          ppmValue: 12,
          recordedById: 'staff-1',
          purchaseEntryId: expect.any(String) as unknown,
          flagged: true,
        },
      });
      // Same transaction as the PurchaseEntry create + Tank update — one
      // $transaction call, three operations.
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const transactionCalls = prisma.$transaction.mock.calls as unknown[][];
      const opsArg = transactionCalls[0][0] as unknown[];
      expect(opsArg).toHaveLength(3);
    });

    it('does not create a DensityLog when densityValue is omitted', async () => {
      prisma.tank.findFirst.mockResolvedValue({
        id: 'tank-1',
        productType: 'petrol',
      });
      prisma.$transaction.mockResolvedValue([{ id: 'pe-1' }, {}]);

      await service.create(baseDto);

      expect(prisma.densityLog.create).not.toHaveBeenCalled();
      const transactionCalls = prisma.$transaction.mock.calls as unknown[][];
      const opsArg = transactionCalls[0][0] as unknown[];
      expect(opsArg).toHaveLength(2);
    });
  });
});
