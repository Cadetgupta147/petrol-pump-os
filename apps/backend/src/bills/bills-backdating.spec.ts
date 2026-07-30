import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EntryChannel, PaymentDirection, PaymentType } from '@prisma/client';
import { BillsService } from './bills.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreditConfigService } from '../credit-config/credit-config.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { RateMasterService } from '../rate-master/rate-master.service';
import { VehicleBlacklistService } from '../vehicle-blacklist/vehicle-blacklist.service';
import { LedgerPostingService } from '../ledger/ledger-posting.service';
import { TaxRateConfigService } from '../tax-rate-config/tax-rate-config.service';
import { CreateBillDto } from './dto/create-bill.dto';
import { UpdateBillDto } from './dto/update-bill.dto';
import { runInTenantContext } from '../common/tenant-context';

// billDate — lets a bill's Bill.timestamp be backdated at entry time, or
// corrected after the fact on edit (reported gap: bills entered for a past
// day were all silently stamped with today's date since Bill.timestamp only
// ever defaulted to now()). See resolveBillTimestamp()'s comment in
// bills.service.ts for why the selected date is combined with the CURRENT
// time-of-day rather than truncated to midnight.
describe('BillsService billDate (backdating)', () => {
  let service: BillsService;
  let prisma: {
    bill: { create: jest.Mock; update: jest.Mock; findFirst: jest.Mock; findUnique: jest.Mock };
    billAuditLog: { create: jest.Mock };
    creditLimitAlert: { create: jest.Mock };
    loyaltyTransaction: { create: jest.Mock };
    loyaltyConfig: { findUnique: jest.Mock };
    billNumberCounter: { update: jest.Mock };
    pump: { findUniqueOrThrow: jest.Mock };
    $transaction: jest.Mock;
  };
  let getCurrentRate: jest.Mock;

  const baseDto: Omit<CreateBillDto, 'amount' | 'litres' | 'paymentLines'> = {
    vehicleNumber: 'KA01AB1234',
    productType: 'diesel',
    entryChannel: EntryChannel.WEB,
  };

  const existingBill = {
    id: 'bill-1',
    vehicleNumber: 'KA01AB1234',
    customerName: null,
    amount: 900,
    litres: 10,
    productType: 'diesel',
    rateApplied: 90,
    customerId: null,
    itemsSubtotal: 0,
    itemsTaxTotal: 0,
    deletedAt: null,
    paymentLines: [{ paymentType: PaymentType.CASH, amount: 900, direction: PaymentDirection.IN }],
  };

  beforeEach(async () => {
    prisma = {
      bill: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'bill-1', ...data })),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...existingBill, ...data })),
        findFirst: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(existingBill),
      },
      billAuditLog: { create: jest.fn().mockResolvedValue({}) },
      creditLimitAlert: { create: jest.fn().mockResolvedValue({}) },
      loyaltyTransaction: { create: jest.fn().mockResolvedValue({}) },
      loyaltyConfig: { findUnique: jest.fn().mockResolvedValue(null) },
      billNumberCounter: { update: jest.fn().mockResolvedValue({ lastSeq: 1 }) },
      pump: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'default_pump', pumpCode: 'PUMP001' }) },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation((cb: (tx: unknown) => Promise<unknown>) => cb(prisma));
    getCurrentRate = jest.fn().mockResolvedValue({ rate: 90 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillsService,
        LoyaltyService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: CreditConfigService,
          useValue: { getOrCreate: jest.fn().mockResolvedValue({ enforcementMode: 'NOTIFY', defaultInformalCreditLimit: 5000 }) },
        },
        { provide: RateMasterService, useValue: { getCurrentRate } },
        { provide: VehicleBlacklistService, useValue: { assertNotBlacklisted: jest.fn().mockResolvedValue(undefined) } },
        { provide: LedgerPostingService, useValue: { postBillVoucher: jest.fn().mockResolvedValue(undefined) } },
        { provide: TaxRateConfigService, useValue: { resolveTaxRateMap: jest.fn().mockResolvedValue({}) } },
      ],
    }).compile();

    service = module.get(BillsService);
  });

  function create(dto: Partial<CreateBillDto>) {
    return runInTenantContext({ pumpId: 'default_pump' }, () =>
      service.create({ ...baseDto, ...dto } as CreateBillDto, 'staff-1'),
    );
  }

  function update(dto: Partial<UpdateBillDto>) {
    return runInTenantContext({ pumpId: 'default_pump' }, () =>
      service.update('bill-1', dto as UpdateBillDto, 'staff-1'),
    );
  }

  it('omitting billDate leaves timestamp unset on create (DB default now() applies)', async () => {
    await create({
      amount: 900,
      litres: 10,
      paymentLines: [{ paymentType: PaymentType.CASH, amount: 900, direction: PaymentDirection.IN }],
    });

    const created = prisma.bill.create.mock.calls[0][0].data;
    expect(created.timestamp).toBeUndefined();
  });

  it('backdates create() to the selected date, keeping the current time-of-day', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 2);
    const y = yesterday.getFullYear();
    const m = String(yesterday.getMonth() + 1).padStart(2, '0');
    const d = String(yesterday.getDate()).padStart(2, '0');
    const billDate = `${y}-${m}-${d}`;

    const now = new Date();
    await create({
      amount: 900,
      litres: 10,
      billDate,
      paymentLines: [{ paymentType: PaymentType.CASH, amount: 900, direction: PaymentDirection.IN }],
    });

    const created = prisma.bill.create.mock.calls[0][0].data;
    const stamped: Date = created.timestamp;
    expect(stamped.getFullYear()).toBe(yesterday.getFullYear());
    expect(stamped.getMonth()).toBe(yesterday.getMonth());
    expect(stamped.getDate()).toBe(yesterday.getDate());
    // Time-of-day carried over from "now", not truncated to midnight.
    expect(stamped.getHours()).toBe(now.getHours());
    expect(stamped.getMinutes()).toBe(now.getMinutes());
  });

  it('rejects a future billDate on create', async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const y = tomorrow.getFullYear();
    const m = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const d = String(tomorrow.getDate()).padStart(2, '0');

    await expect(
      create({
        amount: 900,
        litres: 10,
        billDate: `${y}-${m}-${d}`,
        paymentLines: [{ paymentType: PaymentType.CASH, amount: 900, direction: PaymentDirection.IN }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("accepts today's date as billDate (not treated as 'future')", async () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');

    await expect(
      create({
        amount: 900,
        litres: 10,
        billDate: `${y}-${m}-${d}`,
        paymentLines: [{ paymentType: PaymentType.CASH, amount: 900, direction: PaymentDirection.IN }],
      }),
    ).resolves.toBeDefined();
  });

  it('corrects an already-saved bill\'s date via update()', async () => {
    const target = new Date();
    target.setDate(target.getDate() - 2);
    const y = target.getFullYear();
    const m = String(target.getMonth() + 1).padStart(2, '0');
    const d = String(target.getDate()).padStart(2, '0');

    await update({ billDate: `${y}-${m}-${d}` });

    const updated = prisma.bill.update.mock.calls[0][0].data;
    const stamped: Date = updated.timestamp;
    expect(stamped.getFullYear()).toBe(target.getFullYear());
    expect(stamped.getMonth()).toBe(target.getMonth());
    expect(stamped.getDate()).toBe(target.getDate());
  });

  it('omitting billDate on update leaves the existing timestamp untouched', async () => {
    await update({ productType: 'petrol' });

    const updated = prisma.bill.update.mock.calls[0][0].data;
    expect(updated.timestamp).toBeUndefined();
  });

  it('rejects a future billDate on update', async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const y = tomorrow.getFullYear();
    const m = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const d = String(tomorrow.getDate()).padStart(2, '0');

    await expect(update({ billDate: `${y}-${m}-${d}` })).rejects.toBeInstanceOf(BadRequestException);
  });
});
