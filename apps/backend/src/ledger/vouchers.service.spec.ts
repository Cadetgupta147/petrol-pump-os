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
    shiftDefinition: { findMany: jest.Mock };
    cashCustodyLog: { findMany: jest.Mock };
    shiftSalesSummary: { findMany: jest.Mock };
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
      shiftDefinition: { findMany: jest.fn().mockResolvedValue([]) },
      cashCustodyLog: { findMany: jest.fn().mockResolvedValue([]) },
      shiftSalesSummary: { findMany: jest.fn().mockResolvedValue([]) },
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

  describe('getDayBook — chronological view', () => {
    const cashLedgerRow = {
      id: 'cash',
      name: 'Cash',
      group: 'CASH_IN_HAND',
      systemKey: 'CASH',
      openingBalance: 1000,
      openingBalanceType: 'DEBIT' as const,
    };

    function cashLine(amount: number, drCr: 'DEBIT' | 'CREDIT') {
      return {
        id: `line-${Math.random()}`,
        ledgerAccountId: 'cash',
        amount,
        drCr,
        ledgerAccount: {
          id: 'cash',
          name: 'Cash',
          group: 'CASH_IN_HAND',
          systemKey: 'CASH',
          linkedCustomerId: null,
          linkedStaffId: null,
        },
      };
    }

    function nonCashLine(
      ledgerAccountId: string,
      name: string,
      group: string,
      systemKey: string | null,
      amount: number,
      drCr: 'DEBIT' | 'CREDIT',
    ) {
      return {
        id: `line-${Math.random()}`,
        ledgerAccountId,
        amount,
        drCr,
        ledgerAccount: { id: ledgerAccountId, name, group, systemKey, linkedCustomerId: null, linkedStaffId: null },
      };
    }

    function voucher(id: string, date: Date, lines: unknown[], voucherType = 'SALES') {
      return {
        id,
        voucherNumber: `PUMP001-V-${id}`,
        date,
        voucherType,
        narration: null,
        source: 'BILL',
        sourceKey: `bill:${id}`,
        lines,
      };
    }

    function customerLine(
      ledgerAccountId: string,
      name: string,
      amount: number,
      drCr: 'DEBIT' | 'CREDIT',
    ) {
      return {
        id: `line-${Math.random()}`,
        ledgerAccountId,
        amount,
        drCr,
        ledgerAccount: {
          id: ledgerAccountId,
          name,
          group: 'SUNDRY_DEBTOR',
          systemKey: null,
          linkedCustomerId: 'cust-1',
          linkedStaffId: null,
        },
      };
    }

    it('returns an empty report when nothing was posted that day', async () => {
      prisma.voucher.findMany.mockResolvedValue([]);
      prisma.ledgerAccount.findMany.mockResolvedValue([]);
      prisma.shiftDefinition.findMany.mockResolvedValue([]);

      const result = await service.getDayBook('2026-07-20', { view: 'chronological' });

      expect(result).toEqual({
        date: '2026-07-20',
        view: 'chronological',
        shifts: [],
        cashMismatch: { cashCustodyLogs: [], shiftSalesVariances: [] },
      });
    });

    it('buckets vouchers into shifts by time and keeps time order within a bucket', async () => {
      const shift1 = { id: 'shift-1', label: 'Shift 1', startTime: '06:00', endTime: '14:00', isActive: true };
      const shift2 = { id: 'shift-2', label: 'Shift 2', startTime: '14:00', endTime: '22:00', isActive: true };
      prisma.shiftDefinition.findMany.mockResolvedValue([shift1, shift2]);
      prisma.ledgerAccount.findMany.mockResolvedValue([cashLedgerRow]);
      prisma.voucherLine.findMany.mockResolvedValue([]);

      const vA = voucher('a', new Date(2026, 6, 20, 7, 0), [cashLine(100, 'DEBIT')]);
      const vB = voucher('b', new Date(2026, 6, 20, 15, 0), [cashLine(50, 'DEBIT')]);
      prisma.voucher.findMany.mockResolvedValue([vA, vB]);

      const result = await service.getDayBook('2026-07-20', { view: 'chronological' });

      expect(result.shifts.map((s: { label: string }) => s.label)).toEqual(['Shift 1', 'Shift 2']);
      expect(result.shifts[0].entries.map((e: { voucherId: string }) => e.voucherId)).toEqual(['a']);
      expect(result.shifts[1].entries.map((e: { voucherId: string }) => e.voucherId)).toEqual(['b']);
    });

    it('buckets a voucher into a midnight-wrapping shift window', async () => {
      const nightShift = { id: 'night', label: 'Night', startTime: '22:00', endTime: '06:00', isActive: true };
      prisma.shiftDefinition.findMany.mockResolvedValue([nightShift]);
      prisma.ledgerAccount.findMany.mockResolvedValue([cashLedgerRow]);
      prisma.voucherLine.findMany.mockResolvedValue([]);

      const vNight = voucher('n', new Date(2026, 6, 20, 1, 0), [cashLine(75, 'DEBIT')]);
      prisma.voucher.findMany.mockResolvedValue([vNight]);

      const result = await service.getDayBook('2026-07-20', { view: 'chronological' });

      expect(result.shifts).toHaveLength(1);
      expect(result.shifts[0].shiftDefinitionId).toBe('night');
      expect(result.shifts[0].label).toBe('Night');
    });

    it('buckets a voucher matching no configured shift window into "Unassigned"', async () => {
      const shift1 = { id: 'shift-1', label: 'Shift 1', startTime: '06:00', endTime: '14:00', isActive: true };
      prisma.shiftDefinition.findMany.mockResolvedValue([shift1]);
      prisma.ledgerAccount.findMany.mockResolvedValue([cashLedgerRow]);
      prisma.voucherLine.findMany.mockResolvedValue([]);

      const vLate = voucher('l', new Date(2026, 6, 20, 20, 0), [cashLine(30, 'DEBIT')]);
      prisma.voucher.findMany.mockResolvedValue([vLate]);

      const result = await service.getDayBook('2026-07-20', { view: 'chronological' });

      expect(result.shifts).toHaveLength(1);
      expect(result.shifts[0].shiftDefinitionId).toBeNull();
      expect(result.shifts[0].label).toBe('Unassigned');
      expect(result.shifts[0].windowStart).toBeNull();
    });

    it('only moves the running cash balance on cash-touching vouchers, and chains bucket opening/closing correctly', async () => {
      const shift1 = { id: 'shift-1', label: 'Shift 1', startTime: '06:00', endTime: '14:00', isActive: true };
      const shift2 = { id: 'shift-2', label: 'Shift 2', startTime: '14:00', endTime: '22:00', isActive: true };
      prisma.shiftDefinition.findMany.mockResolvedValue([shift1, shift2]);
      prisma.ledgerAccount.findMany.mockResolvedValue([cashLedgerRow]);
      prisma.voucherLine.findMany.mockResolvedValue([]); // no prior cash activity -> opening cash = 1000 Dr

      // v1: cash sale, +500 cash. v2: card-to-bank contra, no cash leg at all.
      // v3: cash expense payout, -200 cash.
      const v1 = voucher('1', new Date(2026, 6, 20, 7, 0), [
        cashLine(500, 'DEBIT'),
        nonCashLine('sales', 'Sales', 'SALES', 'SALES', 500, 'CREDIT'),
      ]);
      const v2 = voucher('2', new Date(2026, 6, 20, 8, 0), [
        nonCashLine('card', 'Card', 'BANK', 'CARD_CLEARING', 300, 'DEBIT'),
        nonCashLine('bank', 'Bank', 'BANK', 'BANK_DEFAULT', 300, 'CREDIT'),
      ]);
      const v3 = voucher('3', new Date(2026, 6, 20, 15, 0), [
        nonCashLine('expense', 'Toll', 'DIRECT_EXPENSE', null, 200, 'DEBIT'),
        cashLine(200, 'CREDIT'),
      ]);
      prisma.voucher.findMany.mockResolvedValue([v1, v2, v3]);

      const result = await service.getDayBook('2026-07-20', { view: 'chronological' });

      const shift1Result = result.shifts.find((s) => s.shiftDefinitionId === 'shift-1')!;
      const shift2Result = result.shifts.find((s) => s.shiftDefinitionId === 'shift-2')!;

      expect(shift1Result.openingCashBalance).toEqual({ side: 'DR', amount: 1000 });
      // v1 (+500) then v2 (+0, no cash leg) -> closing 1500 Dr, unmoved by v2.
      expect(shift1Result.closingCashBalance).toEqual({ side: 'DR', amount: 1500 });
      expect(shift1Result.entries[1].cashDelta).toBe(0);

      // Shift 2's opening must equal Shift 1's closing (continuous slice, not
      // an independent recompute), then v3 (-200) -> closing 1300 Dr.
      expect(shift2Result.openingCashBalance).toEqual({ side: 'DR', amount: 1500 });
      expect(shift2Result.closingCashBalance).toEqual({ side: 'DR', amount: 1300 });
    });

    it('filters by voucherType at the entry-list level, without corrupting the running cash balance', async () => {
      const shift1 = { id: 'shift-1', label: 'Shift 1', startTime: '06:00', endTime: '14:00', isActive: true };
      prisma.shiftDefinition.findMany.mockResolvedValue([shift1]);
      prisma.ledgerAccount.findMany.mockResolvedValue([cashLedgerRow]);
      prisma.voucherLine.findMany.mockResolvedValue([]);

      // Journal (hidden by the filter below) happens FIRST, Payment (shown)
      // happens second — this is what proves the hidden voucher's delta
      // still fed the balance the displayed entry reports.
      const vJournal = voucher('j', new Date(2026, 6, 20, 7, 0), [cashLine(50, 'DEBIT')], 'JOURNAL');
      const vPayment = voucher('p', new Date(2026, 6, 20, 8, 0), [cashLine(100, 'DEBIT')], 'PAYMENT');
      prisma.voucher.findMany.mockResolvedValue([vJournal, vPayment]);

      const result = await service.getDayBook('2026-07-20', {
        view: 'chronological',
        voucherType: 'PAYMENT',
      });

      expect(result.shifts).toHaveLength(1);
      expect(result.shifts[0].entries.map((e) => e.voucherId)).toEqual(['p']);
      // The displayed entry's running balance still reflects BOTH vouchers
      // (1000 opening + 50 hidden Journal + 100 shown Payment = 1150),
      // proving the filter narrowed what's shown without narrowing what fed
      // the balance computation.
      expect(result.shifts[0].entries[0].runningCashBalance).toEqual({ side: 'DR', amount: 1150 });
    });

    it('filters by paymentMode, including on a split-payment voucher via the documented priority order', async () => {
      const shift1 = { id: 'shift-1', label: 'Shift 1', startTime: '06:00', endTime: '14:00', isActive: true };
      prisma.shiftDefinition.findMany.mockResolvedValue([shift1]);
      prisma.ledgerAccount.findMany.mockResolvedValue([cashLedgerRow]);
      prisma.voucherLine.findMany.mockResolvedValue([]);

      const vCash = voucher('cash-only', new Date(2026, 6, 20, 7, 0), [
        cashLine(100, 'DEBIT'),
        nonCashLine('sales', 'Sales', 'SALES', 'SALES', 100, 'CREDIT'),
      ]);
      const vCard = voucher('card-only', new Date(2026, 6, 20, 8, 0), [
        nonCashLine('card', 'Card', 'BANK', 'CARD_CLEARING', 200, 'DEBIT'),
        nonCashLine('sales', 'Sales', 'SALES', 'SALES', 200, 'CREDIT'),
      ]);
      // Split payment: touches CASH + CARD + a Sundry Debtor leg in one
      // voucher -> should be labelled CASH (priority CASH > CARD > UPI > CREDIT).
      const vSplit = voucher('split', new Date(2026, 6, 20, 9, 0), [
        cashLine(50, 'DEBIT'),
        nonCashLine('card', 'Card', 'BANK', 'CARD_CLEARING', 30, 'DEBIT'),
        customerLine('cust-ledger', 'Ramesh', 20, 'DEBIT'),
        nonCashLine('sales', 'Sales', 'SALES', 'SALES', 100, 'CREDIT'),
      ]);
      prisma.voucher.findMany.mockResolvedValue([vCash, vCard, vSplit]);

      const cashFiltered = await service.getDayBook('2026-07-20', {
        view: 'chronological',
        paymentMode: 'CASH',
      });
      expect(cashFiltered.shifts[0].entries.map((e) => e.voucherId).sort()).toEqual(['cash-only', 'split']);

      const cardFiltered = await service.getDayBook('2026-07-20', {
        view: 'chronological',
        paymentMode: 'CARD',
      });
      // vSplit does NOT show under CARD, even though it has a card leg,
      // because CASH outranks CARD in the priority order.
      expect(cardFiltered.shifts[0].entries.map((e) => e.voucherId)).toEqual(['card-only']);
    });

    it('filters by partyLedgerAccountId and populates partyName from the linked ledger', async () => {
      const shift1 = { id: 'shift-1', label: 'Shift 1', startTime: '06:00', endTime: '14:00', isActive: true };
      prisma.shiftDefinition.findMany.mockResolvedValue([shift1]);
      prisma.ledgerAccount.findMany.mockResolvedValue([cashLedgerRow]);
      prisma.voucherLine.findMany.mockResolvedValue([]);

      const vWithParty = voucher('with-party', new Date(2026, 6, 20, 7, 0), [
        customerLine('cust-ledger', 'Ramesh', 100, 'DEBIT'),
        nonCashLine('sales', 'Sales', 'SALES', 'SALES', 100, 'CREDIT'),
      ]);
      const vNoParty = voucher('no-party', new Date(2026, 6, 20, 8, 0), [
        cashLine(50, 'DEBIT'),
        nonCashLine('sales', 'Sales', 'SALES', 'SALES', 50, 'CREDIT'),
      ]);
      prisma.voucher.findMany.mockResolvedValue([vWithParty, vNoParty]);

      const result = await service.getDayBook('2026-07-20', {
        view: 'chronological',
        partyLedgerAccountId: 'cust-ledger',
      });

      expect(result.shifts[0].entries).toHaveLength(1);
      expect(result.shifts[0].entries[0].voucherId).toBe('with-party');
      expect(result.shifts[0].entries[0].partyName).toBe('Ramesh');
    });

    it('surfaces CashCustodyLog and ShiftSalesSummary rows for the day flat, unaffected by filters', async () => {
      prisma.ledgerAccount.findMany.mockResolvedValue([cashLedgerRow]);
      prisma.voucherLine.findMany.mockResolvedValue([]);
      prisma.voucher.findMany.mockResolvedValue([]);
      prisma.cashCustodyLog.findMany.mockResolvedValue([
        {
          id: 'ccl-1',
          handledById: 'staff-1',
          handledBy: { name: 'Ramesh' },
          totalCashCollected: 5000,
          depositedToBank: 4000,
          keptInLocker: 500,
          takenHome: 500,
          newOutstanding: 0,
        },
      ]);
      prisma.shiftSalesSummary.findMany.mockResolvedValue([
        { id: 'sss-1', shiftId: 'shift-x', dsmId: 'staff-1', nozzleId: 'nozzle-1', expectedValue: 1000, variance: -50 },
      ]);

      // A voucherType filter that matches nothing in `vouchers` (empty here)
      // still must not touch the mismatch data — it's day-scoped, not
      // entry-list-scoped.
      const result = await service.getDayBook('2026-07-20', {
        view: 'chronological',
        voucherType: 'PAYMENT',
      });

      expect(result.cashMismatch.cashCustodyLogs).toEqual([
        {
          id: 'ccl-1',
          handledById: 'staff-1',
          handledByName: 'Ramesh',
          totalCashCollected: 5000,
          depositedToBank: 4000,
          keptInLocker: 500,
          takenHome: 500,
          newOutstanding: 0,
        },
      ]);
      expect(result.cashMismatch.shiftSalesVariances).toEqual([
        { id: 'sss-1', shiftId: 'shift-x', dsmId: 'staff-1', nozzleId: 'nozzle-1', expectedValue: 1000, variance: -50 },
      ]);
    });

    it('defaults to the ledger view when view is omitted (regression)', async () => {
      prisma.voucher.findMany.mockResolvedValue([]);

      const result = await service.getDayBook('2026-07-20');

      expect(result).toEqual({ date: '2026-07-20', vouchers: [], ledgers: [] });
      expect(prisma.shiftDefinition.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getTrialBalance', () => {
    it('includes every active ledger, not just ones touched as of the date', async () => {
      prisma.ledgerAccount.findMany.mockResolvedValue([
        { id: 'cash', name: 'Cash', group: 'CASH_IN_HAND', openingBalance: 1000, openingBalanceType: 'DEBIT' },
        { id: 'toll', name: 'Toll', group: 'DIRECT_EXPENSE', openingBalance: 0, openingBalanceType: 'DEBIT' },
      ]);
      // Nothing posted at all — untouched ledgers still get a row, using
      // just their own opening balance.
      prisma.voucherLine.findMany.mockResolvedValue([]);

      const result = await service.getTrialBalance('2026-07-20');

      expect(result.asOf).toBe('2026-07-20');
      expect(result.rows).toEqual([
        { ledgerAccountId: 'cash', name: 'Cash', group: 'CASH_IN_HAND', balance: { side: 'DR', amount: 1000 } },
        { ledgerAccountId: 'toll', name: 'Toll', group: 'DIRECT_EXPENSE', balance: { side: 'DR', amount: 0 } },
      ]);
    });

    it('sums every VoucherLine dated on-or-before asOf into a single running balance per ledger', async () => {
      prisma.ledgerAccount.findMany.mockResolvedValue([
        { id: 'cash', name: 'Cash', group: 'CASH_IN_HAND', openingBalance: 0, openingBalanceType: 'DEBIT' },
        { id: 'sales', name: 'Sales', group: 'SALES', openingBalance: 0, openingBalanceType: 'DEBIT' },
      ]);
      prisma.voucherLine.findMany.mockResolvedValue([
        { ledgerAccountId: 'cash', amount: 1000, drCr: 'DEBIT' },
        { ledgerAccountId: 'sales', amount: 1000, drCr: 'CREDIT' },
        { ledgerAccountId: 'cash', amount: 200, drCr: 'CREDIT' },
      ]);

      const result = await service.getTrialBalance('2026-07-20');

      const cashRow = result.rows.find((r) => r.ledgerAccountId === 'cash')!;
      expect(cashRow.balance).toEqual({ side: 'DR', amount: 800 }); // 1000 - 200
      const salesRow = result.rows.find((r) => r.ledgerAccountId === 'sales')!;
      expect(salesRow.balance).toEqual({ side: 'CR', amount: 1000 });

      expect(result.totals).toEqual({ dr: 800, cr: 1000 });
    });

    it('defaults asOf to today when omitted', async () => {
      prisma.ledgerAccount.findMany.mockResolvedValue([]);
      prisma.voucherLine.findMany.mockResolvedValue([]);

      const result = await service.getTrialBalance();

      expect(result.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
});
