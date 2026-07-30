import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PaymentType } from '@prisma/client';
import { ExpensesService } from './expenses.service';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerPostingService } from '../ledger/ledger-posting.service';
import { runInTenantContext } from '../common/tenant-context';

describe('ExpensesService', () => {
  let service: ExpensesService;
  let prisma: {
    expenseEntry: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      delete: jest.Mock;
    };
  };
  let ledgerPostingService: { postExpenseVoucher: jest.Mock };

  beforeEach(async () => {
    prisma = {
      expenseEntry: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        delete: jest.fn(),
      },
    };
    // Section 12 — best-effort ledger auto-posting, not under test here (see
    // ledger-posting.service.spec.ts for its own coverage); stubbed to a
    // no-op so ExpensesService.create() doesn't need a real LedgerAccount/
    // Voucher round trip.
    ledgerPostingService = { postExpenseVoucher: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpensesService,
        { provide: PrismaService, useValue: prisma },
        { provide: LedgerPostingService, useValue: ledgerPostingService },
      ],
    }).compile();

    service = module.get(ExpensesService);
  });

  function inTenant<T>(fn: () => Promise<T>) {
    return runInTenantContext({ pumpId: 'pump-1' }, fn);
  }

  it('stamps pumpId from the tenant context and recordedById from the arg, not the DTO', async () => {
    prisma.expenseEntry.create.mockResolvedValue({ id: 'e1' });

    await inTenant(() =>
      service.create(
        {
          category: 'Electricity',
          amount: 2500,
          paidVia: PaymentType.CASH,
        },
        'staff-1',
      ),
    );

    expect(prisma.expenseEntry.create).toHaveBeenCalledWith({
      data: {
        pumpId: 'pump-1',
        category: 'Electricity',
        description: undefined,
        amount: 2500,
        paidVia: PaymentType.CASH,
        recordedById: 'staff-1',
      },
    });
  });

  it('parses an explicit expenseDate to a local start-of-day Date when provided', async () => {
    prisma.expenseEntry.create.mockResolvedValue({ id: 'e1' });

    await inTenant(() =>
      service.create(
        {
          category: 'Diesel top-up',
          amount: 500,
          paidVia: PaymentType.CASH,
          expenseDate: '2026-07-20',
        },
        'staff-1',
      ),
    );

    const calls = prisma.expenseEntry.create.mock.calls as Array<
      [{ data: { expenseDate: Date } }]
    >;
    expect(calls[0][0].data.expenseDate).toEqual(new Date(2026, 6, 20, 0, 0, 0, 0));
  });

  it('findAll applies from/to filters independently', async () => {
    await service.findAll({ from: '2026-07-01', to: '2026-07-31' });

    expect(prisma.expenseEntry.findMany).toHaveBeenCalledWith({
      where: {
        expenseDate: {
          gte: new Date(2026, 6, 1, 0, 0, 0, 0),
          lte: new Date(2026, 6, 31, 23, 59, 59, 999),
        },
      },
      orderBy: { expenseDate: 'desc' },
    });
  });

  it('remove() 404s on an unknown id and does not call delete', async () => {
    prisma.expenseEntry.findUnique.mockResolvedValue(null);

    await expect(service.remove('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.expenseEntry.delete).not.toHaveBeenCalled();
  });

  it('remove() deletes an existing entry', async () => {
    prisma.expenseEntry.findUnique.mockResolvedValue({ id: 'e1' });
    prisma.expenseEntry.delete.mockResolvedValue({ id: 'e1' });

    const result = await service.remove('e1');

    expect(prisma.expenseEntry.delete).toHaveBeenCalledWith({
      where: { id: 'e1' },
    });
    expect(result).toEqual({ id: 'e1' });
  });
});
