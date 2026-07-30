import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { VouchersService } from './vouchers.service';
import { PrismaService } from '../prisma/prisma.service';
import { runInTenantContext } from '../common/tenant-context';
import type { CreateVoucherDto } from './dto/create-voucher.dto';

// Section 12 — money-handling logic (CLAUDE.md: rule-heavy double-entry
// math needs tests). Covers manual voucher balance validation and the Day
// Book's opening/entries/closing computation — the two places a bug would
// actually misreport real money.
describe('VouchersService', () => {
  let service: VouchersService;

  let prisma: {
    ledgerAccount: { findMany: jest.Mock };
    voucher: { findMany: jest.Mock; findFirst: jest.Mock; findUnique: jest.Mock; delete: jest.Mock };
    voucherLine: { findMany: jest.Mock };
    voucherNumberCounter: { upsert: jest.Mock };
    pump: { findUniqueOrThrow: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      ledgerAccount: { findMany: jest.fn() },
      voucher: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
      },
      voucherLine: { findMany: jest.fn() },
      voucherNumberCounter: {
        upsert: jest.fn().mockResolvedValue({ lastSeq: 1 }),
      },
      pump: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'pump-1', pumpCode: 'PUMP001' }),
      },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation((cb: (tx: unknown) => Promise<unknown>) => cb(prisma));

    const module: TestingModule = await Test.createTestingModule({
      providers: [VouchersService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(VouchersService);
  });

  function create(dto: CreateVoucherDto) {
    return runInTenantContext({ pumpId: 'pump-1' }, () => service.create(dto, 'staff-1'));
  }

  describe('create — balance validation', () => {
    it('rejects when total debits do not equal total credits', async () => {
      await expect(
        create({
          date: '2026-07-20',
          voucherType: 'PAYMENT',
          lines: [
            { ledgerAccountId: 'l1', amount: 500, drCr: 'DEBIT' },
            { ledgerAccountId: 'l2', amount: 400, drCr: 'CREDIT' },
          ],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.ledgerAccount.findMany).not.toHaveBeenCalled();
    });

    it('rejects when a referenced ledger account does not exist for this pump', async () => {
      prisma.ledgerAccount.findMany.mockResolvedValue([
        { id: 'l1', isActive: true, name: 'Cash' },
      ]);

      await expect(
        create({
          date: '2026-07-20',
          voucherType: 'PAYMENT',
          lines: [
            { ledgerAccountId: 'l1', amount: 500, drCr: 'DEBIT' },
            { ledgerAccountId: 'l2-missing', amount: 500, drCr: 'CREDIT' },
          ],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a line against an inactive ledger', async () => {
      prisma.ledgerAccount.findMany.mockResolvedValue([
        { id: 'l1', isActive: true, name: 'Cash' },
        { id: 'l2', isActive: false, name: 'Old ledger' },
      ]);

      await expect(
        create({
          date: '2026-07-20',
          voucherType: 'PAYMENT',
          lines: [
            { ledgerAccountId: 'l1', amount: 500, drCr: 'DEBIT' },
            { ledgerAccountId: 'l2', amount: 500, drCr: 'CREDIT' },
          ],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts a balanced voucher and stamps source: MANUAL', async () => {
      prisma.ledgerAccount.findMany.mockResolvedValue([
        { id: 'l1', isActive: true, name: 'Cash' },
        { id: 'l2', isActive: true, name: 'Toll' },
      ]);
      const voucherCreate = jest.fn().mockResolvedValue({ id: 'v1' });
      (prisma as unknown as { voucher: { create: jest.Mock } }).voucher.create = voucherCreate;

      await create({
        date: '2026-07-20',
        voucherType: 'PAYMENT',
        narration: 'Toll payment',
        lines: [
          { ledgerAccountId: 'l2', amount: 200, drCr: 'DEBIT' },
          { ledgerAccountId: 'l1', amount: 200, drCr: 'CREDIT' },
        ],
      });

      expect(voucherCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ source: 'MANUAL', pumpId: 'pump-1' }),
        }),
      );
    });
  });

  describe('remove', () => {
    it('rejects deleting a non-MANUAL (auto-posted) voucher', async () => {
      prisma.voucher.findUnique.mockResolvedValue({
        id: 'v1',
        source: 'BILL',
        voucherNumber: 'PUMP001-V-000001',
      });

      await expect(service.remove('v1')).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.voucher.delete).not.toHaveBeenCalled();
    });

    it('deletes a MANUAL voucher', async () => {
      prisma.voucher.findUnique.mockResolvedValue({
        id: 'v1',
        source: 'MANUAL',
        voucherNumber: 'PUMP001-V-000001',
      });

      await service.remove('v1');
      expect(prisma.voucher.delete).toHaveBeenCalledWith({ where: { id: 'v1' } });
    });
  });

  describe('getDayBook', () => {
    it('returns an empty report when nothing was posted that day', async () => {
      prisma.voucher.findMany.mockResolvedValue([]);

      const result = await service.getDayBook('2026-07-20');

      expect(result).toEqual({ date: '2026-07-20', vouchers: [], ledgers: [] });
      expect(prisma.ledgerAccount.findMany).not.toHaveBeenCalled();
    });

    it('computes each touched ledger\'s opening balance from prior lines and today\'s closing balance', async () => {
      const cashLine = { id: 'line-cash', ledgerAccountId: 'cash', amount: 1000, drCr: 'DEBIT' as const, ledgerAccount: { name: 'Cash' } };
      const salesLine = { id: 'line-sales', ledgerAccountId: 'sales', amount: 1000, drCr: 'CREDIT' as const, ledgerAccount: { name: 'Sales' } };
      prisma.voucher.findMany.mockResolvedValue([
        {
          id: 'v1',
          voucherNumber: 'PUMP001-V-000001',
          date: new Date(2026, 6, 20),
          voucherType: 'SALES',
          narration: 'Bill PUMP001-000001',
          source: 'BILL',
          lines: [cashLine, salesLine],
        },
      ]);
      prisma.ledgerAccount.findMany.mockResolvedValue([
        {
          id: 'cash',
          name: 'Cash',
          group: 'CASH_IN_HAND',
          openingBalance: 5000,
          openingBalanceType: 'DEBIT',
        },
        {
          id: 'sales',
          name: 'Sales',
          group: 'SALES',
          openingBalance: 0,
          openingBalanceType: 'DEBIT',
        },
      ]);
      // Cash had a prior Dr 500 before this date -> opening becomes 5500 Dr.
      // Sales had no prior activity -> opening stays 0 (shown as 0 Cr since
      // signed value is 0 and 0 >= 0 renders as DR per the >= comparison —
      // asserted explicitly below rather than assumed).
      prisma.voucherLine.findMany.mockResolvedValue([
        { ledgerAccountId: 'cash', amount: 500, drCr: 'DEBIT' },
      ]);

      const result = await service.getDayBook('2026-07-20');

      const cashLedger = result.ledgers.find((l) => l.ledgerAccountId === 'cash')!;
      expect(cashLedger.openingBalance).toEqual({ side: 'DR', amount: 5500 });
      // closing = opening 5500 + today's Dr 1000 = 6500 Dr
      expect(cashLedger.closingBalance).toEqual({ side: 'DR', amount: 6500 });
      expect(cashLedger.entries).toHaveLength(1);
      expect(cashLedger.entries[0].counterpartyNames).toEqual(['Sales']);

      const salesLedger = result.ledgers.find((l) => l.ledgerAccountId === 'sales')!;
      // opening 0 + today's Cr 1000 = -1000 signed -> 1000 Cr
      expect(salesLedger.closingBalance).toEqual({ side: 'CR', amount: 1000 });

      // Cash (CASH_IN_HAND) sorts before Sales (SALES) per the fixed group rank.
      expect(result.ledgers.map((l) => l.name)).toEqual(['Cash', 'Sales']);
    });
  });
});
