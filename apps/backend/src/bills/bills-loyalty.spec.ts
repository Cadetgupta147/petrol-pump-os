import { Test, TestingModule } from '@nestjs/testing';
import {
  EarningBasis,
  EntryChannel,
  PaymentDirection,
  PaymentType,
} from '@prisma/client';
import { BillsService } from './bills.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreditConfigService } from '../credit-config/credit-config.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { RateMasterService } from '../rate-master/rate-master.service';
import { CreateBillDto } from './dto/create-bill.dto';

// Section 6.3 step 5 — points credited atomically with bill creation.
// Money/points-touching logic (CLAUDE.md): covers credit-on-create for both
// bases and the override, walk-in no-credit, the no-config
// succeed-with-warning decision, zero-point stamping, quick-add crediting +
// member-id allocation, and transaction-failure propagation.
//
// LoyaltyService here is the REAL service over the same mocked Prisma, so
// these tests exercise the exact computeLoyaltyPoints() path production
// uses — not a re-implementation of the formula.
// jest's asymmetric matchers are typed `any`; these wrappers give them an
// `unknown` type so they can sit inside object-literal expectations without
// tripping @typescript-eslint/no-unsafe-assignment.
const containing = (shape: Record<string, unknown>): unknown =>
  expect.objectContaining(shape) as unknown;
const matchingString = (pattern: RegExp): unknown =>
  expect.stringMatching(pattern) as unknown;

describe('BillsService loyalty crediting (Section 6.3 step 5)', () => {
  let service: BillsService;

  type TxCallback = (tx: unknown) => Promise<unknown>;
  type BillCreateArgs = {
    data: {
      customerId: string | null;
      loyaltyPointsEarned: number;
      loyaltyBasisUsed: EarningBasis | null;
      [key: string]: unknown;
    };
  };

  let prisma: {
    customer: { findUnique: jest.Mock; create: jest.Mock };
    bill: { create: jest.Mock };
    billAuditLog: { create: jest.Mock };
    billPaymentLine: { aggregate: jest.Mock };
    payment: { aggregate: jest.Mock };
    creditLimitAlert: { create: jest.Mock };
    loyaltyTransaction: { create: jest.Mock };
    loyaltyConfig: { findUnique: jest.Mock };
    memberIdCounter: { update: jest.Mock };
    $transaction: jest.Mock;
  };
  let creditConfigService: { getOrCreate: jest.Mock };
  // Section 7.4 — rateApplied is resolved server-side via RateMasterService,
  // not client-supplied (see create-bill.dto.ts). Mocked here so every test
  // exercises BillsService.create() without needing to configure Rate
  // Master rows through Prisma too.
  let rateMasterService: { getCurrentRate: jest.Mock };

  const rupeeConfig = {
    id: 'singleton',
    earningBasis: EarningBasis.RUPEE,
    defaultRate: 2,
  };
  const litreConfig = {
    id: 'singleton',
    earningBasis: EarningBasis.LITRE,
    defaultRate: 0.5,
  };

  // amount 1000 / litres 20, fully CASH-paid, vehicle number present.
  // rateApplied is NOT part of CreateBillDto anymore — see rateMasterService
  // mock above, which resolves it to 100 for every test here.
  const baseDto: Omit<CreateBillDto, 'customerId' | 'quickAddCustomer'> = {
    vehicleNumber: 'KA01AB1234',
    amount: 1000,
    litres: 20,
    productType: 'petrol',
    enteredById: 'staff-1',
    entryChannel: EntryChannel.WEB,
    paymentLines: [
      {
        paymentType: PaymentType.CASH,
        amount: 1000,
        direction: PaymentDirection.IN,
      },
    ],
  };

  beforeEach(async () => {
    prisma = {
      customer: {
        findUnique: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 'cust-new' }),
      },
      bill: {
        create: jest.fn().mockImplementation((args: BillCreateArgs) =>
          Promise.resolve({
            id: 'bill-1',
            ...args.data,
            paymentLines: [],
            customer: null,
          }),
        ),
      },
      billAuditLog: { create: jest.fn().mockResolvedValue({}) },
      billPaymentLine: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
      },
      payment: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
      },
      creditLimitAlert: { create: jest.fn().mockResolvedValue({}) },
      loyaltyTransaction: { create: jest.fn().mockResolvedValue({}) },
      loyaltyConfig: { findUnique: jest.fn() },
      memberIdCounter: {
        update: jest.fn().mockResolvedValue({ id: 'singleton', lastSeq: 6 }),
      },
      $transaction: jest.fn(),
    };
    // The tx client is the same mock object — the assertions below verify
    // every loyalty write goes through it (i.e. inside the transaction).
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillsService,
        LoyaltyService,
        { provide: PrismaService, useValue: prisma },
        { provide: CreditConfigService, useValue: creditConfigService },
        { provide: RateMasterService, useValue: rateMasterService },
      ],
    }).compile();

    service = module.get(BillsService);
  });

  it('rupee basis: credits (amount/100) × defaultRate and writes the LoyaltyTransaction in the same tx', async () => {
    prisma.loyaltyConfig.findUnique.mockResolvedValue(rupeeConfig);
    prisma.customer.findUnique.mockResolvedValue({
      id: 'cust-1',
      loyaltyRateOverride: null,
      creditLimit: 0,
    });

    const result = await service.create({ ...baseDto, customerId: 'cust-1' });

    expect(prisma.bill.create).toHaveBeenCalledWith(
      containing({
        data: containing({
          loyaltyPointsEarned: 20, // (1000 / 100) × 2
          loyaltyBasisUsed: EarningBasis.RUPEE,
        }),
      }),
    );
    expect(prisma.loyaltyTransaction.create).toHaveBeenCalledTimes(1);
    expect(prisma.loyaltyTransaction.create).toHaveBeenCalledWith({
      data: {
        customerId: 'cust-1',
        billId: 'bill-1',
        pointsDelta: 20,
        reason: 'EARNED_ON_BILL',
      },
    });
    expect(result).not.toHaveProperty('loyaltyWarning');
  });

  it('litre basis: credits litres × defaultRate', async () => {
    prisma.loyaltyConfig.findUnique.mockResolvedValue(litreConfig);
    prisma.customer.findUnique.mockResolvedValue({
      id: 'cust-1',
      loyaltyRateOverride: null,
      creditLimit: 0,
    });

    await service.create({ ...baseDto, customerId: 'cust-1' });

    expect(prisma.bill.create).toHaveBeenCalledWith(
      containing({
        data: containing({
          loyaltyPointsEarned: 10, // 20 L × 0.5
          loyaltyBasisUsed: EarningBasis.LITRE,
        }),
      }),
    );
    expect(prisma.loyaltyTransaction.create).toHaveBeenCalledWith(
      containing({
        data: containing({ pointsDelta: 10 }),
      }),
    );
  });

  it('override precedence: loyaltyRateOverride beats the dealer default', async () => {
    prisma.loyaltyConfig.findUnique.mockResolvedValue(rupeeConfig);
    prisma.customer.findUnique.mockResolvedValue({
      id: 'cust-1',
      loyaltyRateOverride: 5,
      creditLimit: 0,
    });

    await service.create({ ...baseDto, customerId: 'cust-1' });

    expect(prisma.loyaltyTransaction.create).toHaveBeenCalledWith(
      containing({
        data: containing({ pointsDelta: 50 }), // (1000/100) × 5
      }),
    );
  });

  it('walk-in bill (no customer): earns nothing, no LoyaltyTransaction', async () => {
    prisma.loyaltyConfig.findUnique.mockResolvedValue(rupeeConfig);

    const result = await service.create({ ...baseDto });

    expect(prisma.bill.create).toHaveBeenCalledWith(
      containing({
        data: containing({
          loyaltyPointsEarned: 0,
          loyaltyBasisUsed: null,
        }),
      }),
    );
    expect(prisma.loyaltyTransaction.create).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty('loyaltyWarning');
  });

  it('no LoyaltyConfig: bill still SUCCEEDS with zero points, no ledger row, and a loud loyaltyWarning', async () => {
    prisma.loyaltyConfig.findUnique.mockResolvedValue(null);
    prisma.customer.findUnique.mockResolvedValue({
      id: 'cust-1',
      loyaltyRateOverride: 5, // even an override can't rescue it — basis unknown
      creditLimit: 0,
    });

    const result = await service.create({ ...baseDto, customerId: 'cust-1' });

    expect(prisma.bill.create).toHaveBeenCalledWith(
      containing({
        data: containing({
          loyaltyPointsEarned: 0,
          loyaltyBasisUsed: null,
        }),
      }),
    );
    expect(prisma.loyaltyTransaction.create).not.toHaveBeenCalled();
    expect(result).toHaveProperty(
      'loyaltyWarning',
      expect.stringContaining('no points were credited'),
    );
  });

  it('no LoyaltyConfig + walk-in: no warning (nothing could ever have been credited)', async () => {
    prisma.loyaltyConfig.findUnique.mockResolvedValue(null);

    const result = await service.create({ ...baseDto });

    expect(result).not.toHaveProperty('loyaltyWarning');
  });

  it('override of 0: stamps the basis but writes no zero-delta ledger row', async () => {
    prisma.loyaltyConfig.findUnique.mockResolvedValue(rupeeConfig);
    prisma.customer.findUnique.mockResolvedValue({
      id: 'cust-1',
      loyaltyRateOverride: 0,
      creditLimit: 0,
    });

    const result = await service.create({ ...baseDto, customerId: 'cust-1' });

    expect(prisma.bill.create).toHaveBeenCalledWith(
      containing({
        data: containing({
          loyaltyPointsEarned: 0,
          loyaltyBasisUsed: EarningBasis.RUPEE,
        }),
      }),
    );
    expect(prisma.loyaltyTransaction.create).not.toHaveBeenCalled();
    // A configured 0-rate is intentional, not misconfiguration — no warning.
    expect(result).not.toHaveProperty('loyaltyWarning');
  });

  it('quick-add credit customer: allocates a formatted member id and credits at the dealer default', async () => {
    prisma.loyaltyConfig.findUnique.mockResolvedValue(rupeeConfig);

    await service.create({
      ...baseDto,
      quickAddCustomer: { name: 'Quick Added', vehicleNumber: 'KA02CD5678' },
      paymentLines: [
        {
          paymentType: PaymentType.CREDIT,
          amount: 1000,
          direction: PaymentDirection.IN,
        },
      ],
    });

    expect(prisma.customer.create).toHaveBeenCalledWith(
      containing({
        data: containing({
          qrMemberId: matchingString(/^PUMP001-CUST-\d{5,}-\d$/),
        }),
      }),
    );
    // Counter increment went through the SAME tx client as the create.
    expect(prisma.memberIdCounter.update).toHaveBeenCalledTimes(1);
    expect(prisma.loyaltyTransaction.create).toHaveBeenCalledWith(
      containing({
        data: containing({
          customerId: 'cust-new',
          pointsDelta: 20, // dealer default — a brand-new customer has no override
        }),
      }),
    );
  });

  it('atomicity: a failing LoyaltyTransaction write rejects the whole create (transaction aborts)', async () => {
    prisma.loyaltyConfig.findUnique.mockResolvedValue(rupeeConfig);
    prisma.customer.findUnique.mockResolvedValue({
      id: 'cust-1',
      loyaltyRateOverride: null,
      creditLimit: 0,
    });
    prisma.loyaltyTransaction.create.mockRejectedValue(
      new Error('simulated ledger write failure'),
    );

    await expect(
      service.create({ ...baseDto, customerId: 'cust-1' }),
    ).rejects.toThrow('simulated ledger write failure');

    // The rejection surfaced from INSIDE $transaction's callback, so with
    // the real Prisma client the whole transaction (bill + payment lines +
    // ledger row) rolls back — no orphan bill without its points, and no
    // points without their bill.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
