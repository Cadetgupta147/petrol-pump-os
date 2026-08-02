import { Test, TestingModule } from '@nestjs/testing';
import { LedgerPostingService } from './ledger-posting.service';
import { PrismaService } from '../prisma/prisma.service';

// Section 12 — money-handling logic (CLAUDE.md: rule-heavy auto-posting math
// needs tests). Covers the Bill/Expense/CashCustody/ShiftSales -> Voucher
// mapping (every posted voucher must balance) and the two idempotency
// strategies (create-once for Bill/Expense/CashCustody, delete-then-
// recreate for ShiftSales) — and that a posting failure never throws past
// this service's boundary (LedgerPostingService's whole reason for
// swallowing errors — see its header comment).
describe('LedgerPostingService', () => {
  let service: LedgerPostingService;

  let prisma: {
    ledgerAccount: { findUnique: jest.Mock; create: jest.Mock };
    ledgerAccountCodeCounter: { upsert: jest.Mock };
    customerOpeningBalance: { aggregate: jest.Mock };
    voucher: { findFirst: jest.Mock; create: jest.Mock; delete: jest.Mock };
    voucherNumberCounter: { upsert: jest.Mock };
    pump: { findUniqueOrThrow: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      ledgerAccount: {
        // get-or-create-by-key helpers always find nothing (fresh-ledger
        // path) and resolve through this one create mock — echo back a
        // stable id derived from the `create` payload's
        // systemKey/name/linkedCustomerId/linkedStaffId so assertions can
        // key off it without caring about exact `where` shapes.
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(({ data }) =>
          Promise.resolve({
            id: data.systemKey ?? data.linkedCustomerId ?? data.linkedStaffId ?? data.name,
            name: data.name,
          }),
        ),
      },
      ledgerAccountCodeCounter: { upsert: jest.fn().mockResolvedValue({ lastSeq: 1 }) },
      // getOrCreateCustomerLedger() sums this to seed a fresh customer
      // ledger's opening balance — no prior CustomerOpeningBalance rows in
      // any of these tests.
      customerOpeningBalance: { aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null } }) },
      voucher: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'v1' }),
        delete: jest.fn().mockResolvedValue({ id: 'v1' }),
      },
      voucherNumberCounter: { upsert: jest.fn().mockResolvedValue({ lastSeq: 1 }) },
      pump: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'pump-1', pumpCode: 'PUMP001' }) },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation((cb: (tx: unknown) => Promise<unknown>) => cb(prisma));

    const module: TestingModule = await Test.createTestingModule({
      providers: [LedgerPostingService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(LedgerPostingService);
  });

  function linesOf(call: number) {
    const data = (prisma.voucher.create.mock.calls[call][0] as { data: { lines: { create: unknown[] } } })
      .data;
    return data.lines.create as { ledgerAccountId: string; amount: number; drCr: string }[];
  }

  describe('postBillVoucher', () => {
    it('posts Dr Cash / Dr Card / Cr Sales for a split cash+card bill, balancing exactly', async () => {
      await service.postBillVoucher(
        {
          id: 'bill-1',
          pumpId: 'pump-1',
          billNumber: 'PUMP001-000001',
          timestamp: new Date(2026, 6, 20),
          customerId: null,
          enteredById: 'staff-1',
          paymentLines: [
            { paymentType: 'CASH', amount: 700, direction: 'IN' },
            { paymentType: 'CARD', amount: 300, direction: 'IN' },
          ],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        null,
      );

      const lines = linesOf(0);
      const debit = lines.filter((l) => l.drCr === 'DEBIT').reduce((s, l) => s + l.amount, 0);
      const credit = lines.filter((l) => l.drCr === 'CREDIT').reduce((s, l) => s + l.amount, 0);
      expect(debit).toBe(credit);
      expect(debit).toBe(1000);
      expect(lines.find((l) => l.ledgerAccountId === 'CASH')?.amount).toBe(700);
      expect(lines.find((l) => l.ledgerAccountId === 'CARD_CLEARING')?.amount).toBe(300);
      expect(lines.find((l) => l.ledgerAccountId === 'SALES')?.drCr).toBe('CREDIT');
    });

    it('posts a CREDIT line against the linked customer\'s own ledger, not a generic bucket', async () => {
      await service.postBillVoucher(
        {
          id: 'bill-2',
          pumpId: 'pump-1',
          billNumber: 'PUMP001-000002',
          timestamp: new Date(2026, 6, 20),
          customerId: 'cust-babuji',
          enteredById: 'staff-1',
          paymentLines: [{ paymentType: 'CREDIT', amount: 500, direction: 'IN' }],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        'Babu Ji',
      );

      const lines = linesOf(0);
      expect(lines.find((l) => l.ledgerAccountId === 'cust-babuji')).toEqual({
        pumpId: 'pump-1',
        ledgerAccountId: 'cust-babuji',
        amount: 500,
        drCr: 'DEBIT',
      });
    });

    // Section 12 fix — postBillVoucher() now reposts (delete-then-recreate)
    // rather than skipping, so an edited bill's voucher stays in sync
    // instead of drifting stale. Same repost-vs-create-once distinction
    // repostShiftSalesVoucher already had — see its own tests below.
    it('reposts (deletes then recreates) rather than skipping when a voucher for this bill already exists', async () => {
      prisma.voucher.findFirst.mockResolvedValueOnce({ id: 'already-posted' });

      await service.postBillVoucher(
        {
          id: 'bill-3',
          pumpId: 'pump-1',
          billNumber: 'PUMP001-000003',
          timestamp: new Date(),
          customerId: null,
          enteredById: 'staff-1',
          paymentLines: [{ paymentType: 'CASH', amount: 100, direction: 'IN' }],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        null,
      );

      expect(prisma.voucher.delete).toHaveBeenCalledWith({ where: { id: 'already-posted' } });
      expect(prisma.voucher.create).toHaveBeenCalledTimes(1);
    });

    it('voids the existing voucher instead of reposting when the edited bill nets to zero', async () => {
      prisma.voucher.findFirst.mockResolvedValueOnce({ id: 'already-posted' });

      await service.postBillVoucher(
        {
          id: 'bill-5',
          pumpId: 'pump-1',
          billNumber: 'PUMP001-000005',
          timestamp: new Date(),
          customerId: null,
          enteredById: 'staff-1',
          paymentLines: [],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        null,
      );

      expect(prisma.voucher.delete).toHaveBeenCalledWith({ where: { id: 'already-posted' } });
      expect(prisma.voucher.create).not.toHaveBeenCalled();
    });

    it('never throws even if Prisma fails (best-effort, per the header comment)', async () => {
      prisma.ledgerAccount.create.mockRejectedValueOnce(new Error('db down'));

      await expect(
        service.postBillVoucher(
          {
            id: 'bill-4',
            pumpId: 'pump-1',
            billNumber: 'PUMP001-000004',
            timestamp: new Date(),
            customerId: null,
            enteredById: 'staff-1',
            paymentLines: [{ paymentType: 'CASH', amount: 100, direction: 'IN' }],
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
          null,
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe('postExpenseVoucher', () => {
    it('posts Dr [category] / Cr [paidVia ledger], balanced', async () => {
      await service.postExpenseVoucher({
        id: 'exp-1',
        pumpId: 'pump-1',
        category: 'Toll',
        description: null,
        amount: 200,
        paidVia: 'CASH',
        recordedById: 'staff-1',
        expenseDate: new Date(2026, 6, 20),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const lines = linesOf(0);
      expect(lines).toEqual([
        { pumpId: 'pump-1', ledgerAccountId: 'Toll', amount: 200, drCr: 'DEBIT' },
        { pumpId: 'pump-1', ledgerAccountId: 'CASH', amount: 200, drCr: 'CREDIT' },
      ]);
    });

    // Section 12 fix — same repost-vs-create-once switch as postBillVoucher.
    it('reposts (deletes then recreates) rather than skipping when a voucher for this expense already exists', async () => {
      prisma.voucher.findFirst.mockResolvedValueOnce({ id: 'already-posted' });

      await service.postExpenseVoucher({
        id: 'exp-2',
        pumpId: 'pump-1',
        category: 'Toll',
        description: null,
        amount: 200,
        paidVia: 'CASH',
        recordedById: 'staff-1',
        expenseDate: new Date(2026, 6, 20),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      expect(prisma.voucher.delete).toHaveBeenCalledWith({ where: { id: 'already-posted' } });
      expect(prisma.voucher.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('postPurchaseVoucher', () => {
    it('posts Dr Purchase / Cr [paidVia clearing ledger] for a cash purchase', async () => {
      await service.postPurchaseVoucher({
        id: 'pe-1',
        pumpId: 'pump-1',
        supplierName: 'IOCL Depot',
        productType: 'petrol',
        quantityLitres: 1000,
        amount: 95000,
        ratePerLitre: 95,
        paidVia: 'CASH',
        recordedById: 'staff-1',
        invoiceNo: null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const lines = linesOf(0);
      expect(lines).toEqual([
        { pumpId: 'pump-1', ledgerAccountId: 'PURCHASE', amount: 95000, drCr: 'DEBIT' },
        { pumpId: 'pump-1', ledgerAccountId: 'CASH', amount: 95000, drCr: 'CREDIT' },
      ]);
    });

    // Finding #2 from docs/ledger-accounting-review.md — this is the actual
    // fix: a REAL per-supplier Sundry Creditor ledger, not one shared bucket.
    it('posts a CREDIT purchase against a per-supplier Sundry Creditor ledger, keyed by supplier name', async () => {
      await service.postPurchaseVoucher({
        id: 'pe-2',
        pumpId: 'pump-1',
        supplierName: 'BPCL Distributor',
        productType: 'diesel',
        quantityLitres: 2000,
        amount: 180000,
        ratePerLitre: 90,
        paidVia: 'CREDIT',
        recordedById: 'staff-1',
        invoiceNo: 'INV-77',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const lines = linesOf(0);
      expect(lines.find((l) => l.ledgerAccountId === 'BPCL Distributor')).toEqual({
        pumpId: 'pump-1',
        ledgerAccountId: 'BPCL Distributor',
        amount: 180000,
        drCr: 'CREDIT',
      });
    });

    it('skips posting entirely when paidVia is null (pre-fix, not ledger-tracked)', async () => {
      await service.postPurchaseVoucher({
        id: 'pe-3',
        pumpId: 'pump-1',
        supplierName: 'IOCL Depot',
        productType: 'petrol',
        quantityLitres: 500,
        amount: 47500,
        ratePerLitre: 95,
        paidVia: null,
        recordedById: 'staff-1',
        invoiceNo: null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      expect(prisma.voucher.create).not.toHaveBeenCalled();
    });

    it('skips posting entirely when recordedById is null (pre-fix, not ledger-tracked)', async () => {
      await service.postPurchaseVoucher({
        id: 'pe-4',
        pumpId: 'pump-1',
        supplierName: 'IOCL Depot',
        productType: 'petrol',
        quantityLitres: 500,
        amount: 47500,
        ratePerLitre: 95,
        paidVia: 'CASH',
        recordedById: null,
        invoiceNo: null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      expect(prisma.voucher.create).not.toHaveBeenCalled();
    });
  });

  describe('voidVoucherBySourceKey', () => {
    it('deletes the existing voucher for that sourceKey and posts nothing new', async () => {
      prisma.voucher.findFirst.mockResolvedValueOnce({ id: 'stale-voucher' });

      await service.voidVoucherBySourceKey('pump-1', 'bill:bill-9');

      expect(prisma.voucher.delete).toHaveBeenCalledWith({ where: { id: 'stale-voucher' } });
      expect(prisma.voucher.create).not.toHaveBeenCalled();
    });

    it('is a no-op when nothing was posted for that sourceKey', async () => {
      prisma.voucher.findFirst.mockResolvedValueOnce(null);

      await service.voidVoucherBySourceKey('pump-1', 'expense:exp-9');

      expect(prisma.voucher.delete).not.toHaveBeenCalled();
      expect(prisma.voucher.create).not.toHaveBeenCalled();
    });

    it('never throws even if Prisma fails (best-effort, same as every other postX method)', async () => {
      prisma.voucher.findFirst.mockRejectedValueOnce(new Error('db down'));

      await expect(
        service.voidVoucherBySourceKey('pump-1', 'bill:bill-9'),
      ).resolves.toBeUndefined();
    });
  });

  describe('postOpeningBalanceAdjustment', () => {
    it('posts a correcting Journal voucher: DEBIT the customer when they owe more, CREDIT the suspense ledger', async () => {
      await service.postOpeningBalanceAdjustment({
        pumpId: 'pump-1',
        customerId: 'cust-1',
        customerName: 'Babu Ji',
        openingBalanceId: 'ob-1',
        amount: 1500,
        effectiveAt: new Date(2026, 6, 20),
        recordedById: 'staff-1',
      });

      const lines = linesOf(0);
      expect(lines).toEqual([
        { pumpId: 'pump-1', ledgerAccountId: 'cust-1', amount: 1500, drCr: 'DEBIT' },
        {
          pumpId: 'pump-1',
          ledgerAccountId: 'OPENING_BALANCE_ADJUSTMENTS',
          amount: 1500,
          drCr: 'CREDIT',
        },
      ]);
    });

    it('flips direction for a negative correction (customer owes less)', async () => {
      await service.postOpeningBalanceAdjustment({
        pumpId: 'pump-1',
        customerId: 'cust-1',
        customerName: 'Babu Ji',
        openingBalanceId: 'ob-2',
        amount: -800,
        effectiveAt: new Date(2026, 6, 20),
        recordedById: 'staff-1',
      });

      const lines = linesOf(0);
      expect(lines.find((l) => l.ledgerAccountId === 'cust-1')?.drCr).toBe('CREDIT');
      expect(lines.find((l) => l.ledgerAccountId === 'OPENING_BALANCE_ADJUSTMENTS')?.drCr).toBe(
        'DEBIT',
      );
    });

    it('does nothing for a negligible (rounding-noise) amount', async () => {
      await service.postOpeningBalanceAdjustment({
        pumpId: 'pump-1',
        customerId: 'cust-1',
        customerName: 'Babu Ji',
        openingBalanceId: 'ob-3',
        amount: 0.001,
        effectiveAt: new Date(2026, 6, 20),
        recordedById: 'staff-1',
      });

      expect(prisma.voucher.create).not.toHaveBeenCalled();
    });
  });

  describe('postCashCustodyVoucher', () => {
    it('posts a balanced contra voucher covering deposit + taken-home + brought-back legs', async () => {
      await service.postCashCustodyVoucher(
        {
          id: 'log-1',
          pumpId: 'pump-1',
          date: new Date(2026, 6, 20),
          depositedToBank: 500,
          keptInLocker: 200,
          takenHome: 100,
          broughtBackToday: 50,
          handledById: 'staff-1',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        'Ramesh',
      );

      const lines = linesOf(0);
      const debit = lines.filter((l) => l.drCr === 'DEBIT').reduce((s, l) => s + l.amount, 0);
      const credit = lines.filter((l) => l.drCr === 'CREDIT').reduce((s, l) => s + l.amount, 0);
      expect(debit).toBe(credit);
      expect(debit).toBe(650); // 500 + 100 + 50
    });

    // Section 12 fix — finding #7: a dealer-picked specific Bank ledger,
    // instead of always the one generic system Bank ledger.
    it('deposits to the named bankLedgerAccountId instead of the generic system Bank ledger', async () => {
      // getOrCreateSystemLedger('CASH', ...) also calls findUnique — must
      // only override the lookup BY ID (the bank-ledger check), not every
      // findUnique call, or the CASH resolution above it in
      // postCashCustodyVoucher would wrongly pick this up instead.
      prisma.ledgerAccount.findUnique.mockImplementation((args: { where: { id?: string } }) =>
        args.where.id === 'sbi-ledger'
          ? Promise.resolve({ id: 'sbi-ledger', name: 'SBI' })
          : Promise.resolve(null),
      );

      await service.postCashCustodyVoucher(
        {
          id: 'log-3',
          pumpId: 'pump-1',
          date: new Date(2026, 6, 20),
          depositedToBank: 500,
          keptInLocker: 0,
          takenHome: 0,
          broughtBackToday: 0,
          handledById: 'staff-1',
          bankLedgerAccountId: 'sbi-ledger',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        'Ramesh',
      );

      const lines = linesOf(0);
      expect(lines.find((l) => l.ledgerAccountId === 'sbi-ledger')).toEqual({
        pumpId: 'pump-1',
        ledgerAccountId: 'sbi-ledger',
        amount: 500,
        drCr: 'DEBIT',
      });
      expect(lines.find((l) => l.ledgerAccountId === 'BANK_DEFAULT')).toBeUndefined();
    });

    it('posts nothing when the whole day\'s cash stayed in the locker (all other legs zero)', async () => {
      await service.postCashCustodyVoucher(
        {
          id: 'log-2',
          pumpId: 'pump-1',
          date: new Date(2026, 6, 20),
          depositedToBank: 0,
          keptInLocker: 1000,
          takenHome: 0,
          broughtBackToday: 0,
          handledById: 'staff-1',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        'Ramesh',
      );

      expect(prisma.voucher.create).not.toHaveBeenCalled();
    });
  });

  describe('repostShiftSalesVoucher', () => {
    it('creates a Dr [Cash/Card/UPI] / Cr Sales voucher for a fresh shift', async () => {
      await service.repostShiftSalesVoucher({
        pumpId: 'pump-1',
        shiftSalesSummaryId: 'sss-1',
        dsmId: 'dsm-1',
        walkInCashCollected: 300,
        walkInCardCollected: 0,
        walkInUpiCollected: 150,
        date: new Date(2026, 6, 20),
      });

      const lines = linesOf(0);
      expect(lines.find((l) => l.ledgerAccountId === 'CASH')?.amount).toBe(300);
      expect(lines.find((l) => l.ledgerAccountId === 'UPI_CLEARING')?.amount).toBe(150);
      expect(lines.find((l) => l.ledgerAccountId === 'SALES')).toEqual({
        pumpId: 'pump-1',
        ledgerAccountId: 'SALES',
        amount: 450,
        drCr: 'CREDIT',
      });
    });

    it('deletes the prior voucher before recreating it (repost, not create-once)', async () => {
      prisma.voucher.findFirst.mockResolvedValueOnce({ id: 'old-voucher' });

      await service.repostShiftSalesVoucher({
        pumpId: 'pump-1',
        shiftSalesSummaryId: 'sss-1',
        dsmId: 'dsm-1',
        walkInCashCollected: 400,
        walkInCardCollected: 0,
        walkInUpiCollected: 0,
        date: new Date(2026, 6, 20),
      });

      expect(prisma.voucher.delete).toHaveBeenCalledWith({ where: { id: 'old-voucher' } });
      expect(prisma.voucher.create).toHaveBeenCalledTimes(1);
    });

    it('deletes and does not recreate when the shift now has zero collected', async () => {
      prisma.voucher.findFirst.mockResolvedValueOnce({ id: 'old-voucher' });

      await service.repostShiftSalesVoucher({
        pumpId: 'pump-1',
        shiftSalesSummaryId: 'sss-1',
        dsmId: 'dsm-1',
        walkInCashCollected: 0,
        walkInCardCollected: 0,
        walkInUpiCollected: 0,
        date: new Date(2026, 6, 20),
      });

      expect(prisma.voucher.delete).toHaveBeenCalledWith({ where: { id: 'old-voucher' } });
      expect(prisma.voucher.create).not.toHaveBeenCalled();
    });
  });
});
