import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { EntryChannel, PaymentDirection, PaymentType } from '@prisma/client';
import { BillsService } from './bills.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreditConfigService } from '../credit-config/credit-config.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { RateMasterService } from '../rate-master/rate-master.service';
import { VehicleBlacklistService } from '../vehicle-blacklist/vehicle-blacklist.service';
import { LedgerPostingService } from '../ledger/ledger-posting.service';
import { CreateBillDto } from './dto/create-bill.dto';
import { runInTenantContext } from '../common/tenant-context';

// Section 3.4B — BillsService.create()'s integration with the vehicle
// blacklist: only CREDIT bills are checked, every vehicle-number candidate
// the bill carries is passed through, and a blocked check must actually
// abort bill creation (not just get called and ignored).
describe('BillsService vehicle blacklist enforcement (Section 3.4B)', () => {
  let service: BillsService;

  type TxCallback = (tx: unknown) => Promise<unknown>;

  let prisma: {
    customer: { findUnique: jest.Mock; create: jest.Mock };
    bill: { create: jest.Mock };
    billAuditLog: { create: jest.Mock };
    billPaymentLine: { aggregate: jest.Mock };
    payment: { aggregate: jest.Mock };
    customerOpeningBalance: { aggregate: jest.Mock };
    creditLimitAlert: { create: jest.Mock };
    memberIdCounter: { update: jest.Mock };
    billNumberCounter: { update: jest.Mock };
    pump: { findUniqueOrThrow: jest.Mock };
    $transaction: jest.Mock;
  };
  let creditConfigService: { getOrCreate: jest.Mock };
  let rateMasterService: { getCurrentRate: jest.Mock };
  let loyaltyService: { getConfig: jest.Mock };
  let vehicleBlacklistService: { assertNotBlacklisted: jest.Mock };

  const creditDto: CreateBillDto = {
    vehicleNumber: 'KA01AB1234',
    customerId: 'cust-1',
    amount: 1000,
    litres: 10,
    productType: 'petrol',
    entryChannel: EntryChannel.WEB,
    paymentLines: [
      { paymentType: PaymentType.CREDIT, amount: 1000, direction: PaymentDirection.IN },
    ],
  };

  const cashDto: CreateBillDto = {
    ...creditDto,
    paymentLines: [
      { paymentType: PaymentType.CASH, amount: 1000, direction: PaymentDirection.IN },
    ],
  };

  beforeEach(async () => {
    prisma = {
      customer: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'cust-1',
          vehicleNumber: 'KA01AB1234',
          companyName: null,
          creditLimit: 5000,
          loyaltyRateOverride: null,
        }),
        create: jest.fn().mockResolvedValue({ id: 'cust-new' }),
      },
      bill: {
        create: jest.fn().mockResolvedValue({
          id: 'bill-1',
          paymentLines: [],
          customer: null,
        }),
      },
      billAuditLog: { create: jest.fn().mockResolvedValue({}) },
      billPaymentLine: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
      },
      payment: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
      },
      customerOpeningBalance: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
      },
      creditLimitAlert: { create: jest.fn().mockResolvedValue({}) },
      memberIdCounter: {
        update: jest.fn().mockResolvedValue({ id: 'singleton', pumpId: 'default_pump', lastSeq: 1 }),
      },
      billNumberCounter: {
        update: jest.fn().mockResolvedValue({ id: 'billctr_default_pump', pumpId: 'default_pump', lastSeq: 1 }),
      },
      pump: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'default_pump', pumpCode: 'PUMP001' }),
      },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation((cb: TxCallback) => cb(prisma));

    creditConfigService = {
      getOrCreate: jest.fn().mockResolvedValue({
        enforcementMode: 'NOTIFY',
        defaultInformalCreditLimit: 5000,
      }),
    };
    rateMasterService = {
      getCurrentRate: jest.fn().mockResolvedValue({
        id: 'rh-1',
        productType: 'petrol',
        rate: 100,
        effectiveFrom: new Date('2026-01-01T00:00:00Z'),
      }),
    };
    // Loyalty isn't this spec's concern — no config, bill succeeds with a
    // warning, same as bills-loyalty.spec.ts's "no LoyaltyConfig" case.
    loyaltyService = { getConfig: jest.fn().mockResolvedValue(null) };
    vehicleBlacklistService = { assertNotBlacklisted: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillsService,
        { provide: PrismaService, useValue: prisma },
        { provide: CreditConfigService, useValue: creditConfigService },
        { provide: RateMasterService, useValue: rateMasterService },
        { provide: LoyaltyService, useValue: loyaltyService },
        { provide: VehicleBlacklistService, useValue: vehicleBlacklistService },
        { provide: LedgerPostingService, useValue: { postBillVoucher: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();

    service = module.get(BillsService);
  });

  function create(dto: CreateBillDto) {
    return runInTenantContext({ pumpId: 'default_pump' }, () =>
      service.create(dto, 'staff-1'),
    );
  }

  it('checks the blacklist for a CREDIT bill, passing every vehicle-number candidate plus companyName/customerId', async () => {
    await create(creditDto);

    expect(vehicleBlacklistService.assertNotBlacklisted).toHaveBeenCalledTimes(1);
    expect(vehicleBlacklistService.assertNotBlacklisted).toHaveBeenCalledWith({
      vehicleNumbers: ['KA01AB1234', 'KA01AB1234', undefined],
      companyName: null,
      customerId: 'cust-1',
    });
  });

  it('never checks the blacklist for a non-CREDIT bill (cash/UPI/card sales are never blocked)', async () => {
    await create(cashDto);

    expect(vehicleBlacklistService.assertNotBlacklisted).not.toHaveBeenCalled();
  });

  it('aborts bill creation when the blacklist check throws — no Bill row is written', async () => {
    vehicleBlacklistService.assertNotBlacklisted.mockRejectedValue(
      new BadRequestException('Vehicle KA01AB1234 is blacklisted: unpaid dues.'),
    );

    await expect(create(creditDto)).rejects.toThrow(BadRequestException);
    expect(prisma.bill.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('quick-add CREDIT bills are checked too, using the quick-add vehicleNumber candidate', async () => {
    const quickAddDto: CreateBillDto = {
      vehicleNumber: 'KA02CD5678',
      quickAddCustomer: { name: 'Walk-in', vehicleNumber: 'KA02CD5678' },
      amount: 500,
      litres: 5,
      productType: 'diesel',
      entryChannel: EntryChannel.DSM_APP,
      paymentLines: [
        { paymentType: PaymentType.CREDIT, amount: 500, direction: PaymentDirection.IN },
      ],
    };

    await create(quickAddDto);

    expect(vehicleBlacklistService.assertNotBlacklisted).toHaveBeenCalledWith({
      vehicleNumbers: ['KA02CD5678', undefined, 'KA02CD5678'],
      companyName: undefined,
      customerId: undefined,
    });
  });
});

// Section 3.4 — a customer onboarded with a CustomerOpeningBalance (see
// prisma/schema.prisma) must have that due counted in credit-limit
// enforcement, not just in CustomersService.ledger().
describe('BillsService credit-limit evaluation includes CustomerOpeningBalance', () => {
  let service: BillsService;

  type TxCallback = (tx: unknown) => Promise<unknown>;

  let prisma: {
    customer: { findUnique: jest.Mock };
    bill: { create: jest.Mock };
    billAuditLog: { create: jest.Mock };
    billPaymentLine: { aggregate: jest.Mock };
    payment: { aggregate: jest.Mock };
    customerOpeningBalance: { aggregate: jest.Mock };
    creditLimitAlert: { create: jest.Mock };
    memberIdCounter: { update: jest.Mock };
    billNumberCounter: { update: jest.Mock };
    pump: { findUniqueOrThrow: jest.Mock };
    $transaction: jest.Mock;
  };

  const creditDto: CreateBillDto = {
    customerId: 'cust-1',
    customerName: 'Legacy Customer',
    amount: 1000,
    litres: 10,
    productType: 'petrol',
    entryChannel: EntryChannel.WEB,
    paymentLines: [
      { paymentType: PaymentType.CREDIT, amount: 1000, direction: PaymentDirection.IN },
    ],
  };

  beforeEach(async () => {
    prisma = {
      customer: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'cust-1',
          vehicleNumber: null,
          companyName: null,
          creditLimit: 5000,
          loyaltyRateOverride: null,
        }),
      },
      bill: {
        create: jest.fn().mockResolvedValue({ id: 'bill-1', paymentLines: [], customer: null }),
      },
      billAuditLog: { create: jest.fn().mockResolvedValue({}) },
      billPaymentLine: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
      },
      payment: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
      },
      // The customer already owed ₹4500 before ever using this system.
      customerOpeningBalance: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 4500 } }),
      },
      creditLimitAlert: { create: jest.fn().mockResolvedValue({}) },
      memberIdCounter: {
        update: jest.fn().mockResolvedValue({ id: 'singleton', pumpId: 'default_pump', lastSeq: 1 }),
      },
      billNumberCounter: {
        update: jest.fn().mockResolvedValue({ id: 'billctr_default_pump', pumpId: 'default_pump', lastSeq: 1 }),
      },
      pump: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'default_pump', pumpCode: 'PUMP001' }),
      },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation((cb: TxCallback) => cb(prisma));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillsService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: CreditConfigService,
          useValue: {
            getOrCreate: jest.fn().mockResolvedValue({
              enforcementMode: 'NOTIFY',
              defaultInformalCreditLimit: 5000,
            }),
          },
        },
        {
          provide: RateMasterService,
          useValue: {
            getCurrentRate: jest.fn().mockResolvedValue({
              id: 'rh-1',
              productType: 'petrol',
              rate: 100,
              effectiveFrom: new Date('2026-01-01T00:00:00Z'),
            }),
          },
        },
        { provide: LoyaltyService, useValue: { getConfig: jest.fn().mockResolvedValue(null) } },
        {
          provide: VehicleBlacklistService,
          useValue: { assertNotBlacklisted: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: LedgerPostingService, useValue: { postBillVoucher: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();

    service = module.get(BillsService);
  });

  it('folds the opening balance into outstandingBefore, flagging a bill that pushes past the limit', async () => {
    await runInTenantContext({ pumpId: 'default_pump' }, () =>
      service.create(creditDto, 'staff-1'),
    );

    // outstandingBefore = 4500 (opening) + 0 (no prior bills/payments) = 4500
    // overage = 4500 + 1000 (this bill) - 5000 (limit) = 500
    expect(prisma.creditLimitAlert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          outstandingBefore: 4500,
          billNetCredit: 1000,
          creditLimit: 5000,
          overageAmount: 500,
        }) as unknown,
      }),
    );
  });
});
