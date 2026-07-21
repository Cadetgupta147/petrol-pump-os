import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { BillsService } from './bills.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreditConfigService } from '../credit-config/credit-config.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { RateMasterService } from '../rate-master/rate-master.service';

// Section 3.2 — GET /bills filtering + opt-in pagination (BillsService.findAll()).
// Covers: each filter builds the expected Prisma where clause, filters
// combine via AND, pagination only applies take/skip when limit is given,
// and the "to before from" cross-field validation.
describe('BillsService.findAll (Section 3.2 register filters)', () => {
  let service: BillsService;
  let prisma: {
    bill: { findMany: jest.Mock; count: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      bill: { findMany: jest.fn(), count: jest.fn() },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillsService,
        { provide: PrismaService, useValue: prisma },
        { provide: CreditConfigService, useValue: {} },
        { provide: LoyaltyService, useValue: {} },
        { provide: RateMasterService, useValue: {} },
      ],
    }).compile();

    service = module.get<BillsService>(BillsService);
    prisma.bill.findMany.mockResolvedValue([]);
    prisma.bill.count.mockResolvedValue(0);
  });

  it('with no query params, returns every non-deleted bill unbounded (no take/skip)', async () => {
    await service.findAll();

    expect(prisma.bill.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { deletedAt: null },
      }),
    );
    const call = prisma.bill.findMany.mock.calls[0][0] as { take?: unknown; skip?: unknown };
    expect(call.take).toBeUndefined();
    expect(call.skip).toBeUndefined();
  });

  it('filters by customerId', async () => {
    await service.findAll({ customerId: 'cust-1' });
    expect(prisma.bill.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { deletedAt: null, customerId: 'cust-1' },
      }),
    );
  });

  it('filters by staffId (maps to enteredById)', async () => {
    await service.findAll({ staffId: 'staff-1' });
    expect(prisma.bill.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { deletedAt: null, enteredById: 'staff-1' },
      }),
    );
  });

  it('filters by vehicleNumber with a case-insensitive partial match', async () => {
    await service.findAll({ vehicleNumber: 'MH12' });
    expect(prisma.bill.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          deletedAt: null,
          vehicleNumber: { contains: 'MH12', mode: 'insensitive' },
        },
      }),
    );
  });

  it('filters by paymentType via a paymentLines.some IN-direction match', async () => {
    await service.findAll({ paymentType: 'UPI' });
    expect(prisma.bill.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          deletedAt: null,
          paymentLines: { some: { paymentType: 'UPI', direction: 'IN' } },
        },
      }),
    );
  });

  it('filters by a from/to date range', async () => {
    await service.findAll({ from: '2026-07-01', to: '2026-07-31' });
    const call = prisma.bill.findMany.mock.calls[0][0] as {
      where: { timestamp?: { gte?: Date; lte?: Date } };
    };
    expect(call.where.timestamp?.gte).toEqual(new Date(2026, 6, 1, 0, 0, 0, 0));
    expect(call.where.timestamp?.lte).toEqual(new Date(2026, 6, 31, 23, 59, 59, 999));
  });

  it('accepts an open-ended "from" with no "to"', async () => {
    await service.findAll({ from: '2026-07-01' });
    const call = prisma.bill.findMany.mock.calls[0][0] as {
      where: { timestamp?: { gte?: Date; lte?: Date } };
    };
    expect(call.where.timestamp?.gte).toEqual(new Date(2026, 6, 1, 0, 0, 0, 0));
    expect(call.where.timestamp?.lte).toBeUndefined();
  });

  it('rejects a "to" before "from"', async () => {
    await expect(
      service.findAll({ from: '2026-07-31', to: '2026-07-01' }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.bill.findMany).not.toHaveBeenCalled();
  });

  it('combines multiple filters with AND semantics (all present in one where clause)', async () => {
    await service.findAll({
      customerId: 'cust-1',
      staffId: 'staff-1',
      paymentType: 'CASH',
      vehicleNumber: 'MH12',
    });
    expect(prisma.bill.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          deletedAt: null,
          customerId: 'cust-1',
          enteredById: 'staff-1',
          vehicleNumber: { contains: 'MH12', mode: 'insensitive' },
          paymentLines: { some: { paymentType: 'CASH', direction: 'IN' } },
        },
      }),
    );
  });

  it('applies take/skip only when limit is provided, defaulting skip to 0', async () => {
    await service.findAll({ limit: 25 });
    expect(prisma.bill.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 25, skip: 0 }),
    );
  });

  it('applies the provided offset alongside limit', async () => {
    await service.findAll({ limit: 25, offset: 50 });
    expect(prisma.bill.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 25, skip: 50 }),
    );
  });

  it('returns { bills, total } with total from a matching count query', async () => {
    prisma.bill.findMany.mockResolvedValue([{ id: 'b1' }]);
    prisma.bill.count.mockResolvedValue(1);

    const result = await service.findAll({ customerId: 'cust-1' });

    expect(result).toEqual({ bills: [{ id: 'b1' }], total: 1 });
    expect(prisma.bill.count).toHaveBeenCalledWith({
      where: { deletedAt: null, customerId: 'cust-1' },
    });
  });
});
