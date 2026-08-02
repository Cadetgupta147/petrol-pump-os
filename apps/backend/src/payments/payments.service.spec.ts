import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerPostingService } from '../ledger/ledger-posting.service';
import { CustomersService } from '../customers/customers.service';
import { runInTenantContext } from '../common/tenant-context';
import type { CreatePaymentDto } from './dto/create-payment.dto';

// Section 3.4 — money-handling logic (CLAUDE.md: rule-heavy repayment
// allocation needs tests). Covers the "Agst Ref" bill-wise validation: a
// payment allocated against a specific bill can never exceed what's still
// actually due on THAT bill, accounting for any prior payments already
// allocated to it.
describe('PaymentsService', () => {
  let service: PaymentsService;

  let prisma: {
    payment: { create: jest.Mock; aggregate: jest.Mock };
    bill: { findFirst: jest.Mock };
  };
  let customersService: { findOne: jest.Mock };
  let ledgerPostingService: { postPaymentVoucher: jest.Mock };

  beforeEach(async () => {
    prisma = {
      payment: {
        create: jest.fn(),
        aggregate: jest.fn(),
      },
      bill: {
        findFirst: jest.fn(),
      },
    };
    customersService = {
      findOne: jest.fn().mockResolvedValue({ id: 'cust-1', name: 'Ramesh' }),
    };
    // Section 12 — best-effort ledger auto-posting, not under test here (see
    // ledger-posting.service.spec.ts for its own coverage).
    ledgerPostingService = { postPaymentVoucher: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: CustomersService, useValue: customersService },
        { provide: LedgerPostingService, useValue: ledgerPostingService },
      ],
    }).compile();

    service = module.get(PaymentsService);
  });

  function createPayment(customerId: string, dto: CreatePaymentDto) {
    return runInTenantContext({ pumpId: 'pump-1' }, () =>
      service.create(customerId, dto, 'staff-1'),
    );
  }

  it('propagates a 404 when the customer does not exist (or belongs to a different pump)', async () => {
    customersService.findOne.mockRejectedValueOnce(new NotFoundException());

    await expect(
      createPayment('cust-1', { amount: 500, method: 'CASH' } as CreatePaymentDto),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  describe('on-account payment (no billId)', () => {
    it('creates the payment without looking up any bill', async () => {
      prisma.payment.create.mockResolvedValue({ id: 'pay-1', amount: 500 });

      await createPayment('cust-1', { amount: 500, method: 'CASH' } as CreatePaymentDto);

      expect(prisma.bill.findFirst).not.toHaveBeenCalled();
      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ customerId: 'cust-1', amount: 500, billId: undefined }),
        }),
      );
    });

    it('posts the auto ledger voucher for the created payment', async () => {
      const created = { id: 'pay-1', amount: 500 };
      prisma.payment.create.mockResolvedValue(created);

      await createPayment('cust-1', { amount: 500, method: 'UPI' } as CreatePaymentDto);

      expect(ledgerPostingService.postPaymentVoucher).toHaveBeenCalledWith(created, 'Ramesh');
    });
  });

  describe('payment allocated against a specific bill ("Agst Ref")', () => {
    it('rejects when the referenced bill does not exist for this customer', async () => {
      prisma.bill.findFirst.mockResolvedValue(null);

      await expect(
        createPayment('cust-1', {
          amount: 500,
          method: 'CASH',
          billId: 'bill-404',
        } as CreatePaymentDto),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('rejects when the bill was not sold on credit (nothing to repay)', async () => {
      prisma.bill.findFirst.mockResolvedValue({
        id: 'bill-1',
        billNumber: 'PUMP001-000001',
        paymentLines: [{ paymentType: 'CASH', direction: 'IN', amount: 1000 }],
      });

      await expect(
        createPayment('cust-1', {
          amount: 500,
          method: 'CASH',
          billId: 'bill-1',
        } as CreatePaymentDto),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('rejects a payment that exceeds the remaining due on the bill', async () => {
      prisma.bill.findFirst.mockResolvedValue({
        id: 'bill-1',
        billNumber: 'PUMP001-000001',
        paymentLines: [{ paymentType: 'CREDIT', direction: 'IN', amount: 1000 }],
      });
      prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: null } }); // nothing allocated yet

      await expect(
        createPayment('cust-1', {
          amount: 1500, // more than the bill's 1000 net credit
          method: 'CASH',
          billId: 'bill-1',
        } as CreatePaymentDto),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('accounts for prior payments already allocated to the same bill', async () => {
      prisma.bill.findFirst.mockResolvedValue({
        id: 'bill-1',
        billNumber: 'PUMP001-000001',
        paymentLines: [{ paymentType: 'CREDIT', direction: 'IN', amount: 1000 }],
      });
      // 700 already settled against this bill -> only 300 remains due
      prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 700 } });

      await expect(
        createPayment('cust-1', {
          amount: 301, // 1 rupee over the remaining 300
          method: 'CASH',
          billId: 'bill-1',
        } as CreatePaymentDto),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('accepts a payment that exactly settles the remaining due', async () => {
      prisma.bill.findFirst.mockResolvedValue({
        id: 'bill-1',
        billNumber: 'PUMP001-000001',
        paymentLines: [{ paymentType: 'CREDIT', direction: 'IN', amount: 1000 }],
      });
      prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 700 } });
      prisma.payment.create.mockResolvedValue({ id: 'pay-2', amount: 300 });

      await createPayment('cust-1', {
        amount: 300,
        method: 'CASH',
        billId: 'bill-1',
      } as CreatePaymentDto);

      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ billId: 'bill-1', amount: 300 }),
        }),
      );
    });

    it('nets CREDIT direction OUT lines (e.g. a corrected bill) out of the bill\'s due amount', async () => {
      prisma.bill.findFirst.mockResolvedValue({
        id: 'bill-1',
        billNumber: 'PUMP001-000001',
        paymentLines: [
          { paymentType: 'CREDIT', direction: 'IN', amount: 1000 },
          { paymentType: 'CREDIT', direction: 'OUT', amount: 400 }, // net credit is only 600
        ],
      });
      prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: null } });

      await expect(
        createPayment('cust-1', {
          amount: 601,
          method: 'CASH',
          billId: 'bill-1',
        } as CreatePaymentDto),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
