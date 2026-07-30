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
import { CreateBillDto } from './dto/create-bill.dto';
import { runInTenantContext } from '../common/tenant-context';

// Covers assertAmountMatchesRate()'s tolerance (see that method's comment in
// bills.service.ts) — added alongside widening it from a flat BALANCE_EPSILON
// (₹0.01) to a rate-scaled one, after the flat tolerance turned out to reject
// the ordinary "type amount, let litres auto-fill" UI flow (AddBillModal /
// NewBillScreen): litres is only ever entered/stored to 0.01 L, so
// round-tripping a typed amount through rounded litres and back through the
// rate can legitimately land more than a paisa off the original amount.
describe('BillsService.assertAmountMatchesRate tolerance', () => {
  let service: BillsService;
  let prisma: {
    bill: { create: jest.Mock; findFirst: jest.Mock };
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

  beforeEach(async () => {
    prisma = {
      bill: {
        create: jest.fn().mockResolvedValue({ id: 'bill-1' }),
        findFirst: jest.fn(),
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
    getCurrentRate = jest.fn();

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
      ],
    }).compile();

    service = module.get(BillsService);
  });

  function create(dto: Partial<CreateBillDto>) {
    return runInTenantContext({ pumpId: 'default_pump' }, () =>
      service.create({ ...baseDto, ...dto } as CreateBillDto, 'staff-1'),
    );
  }

  it('accepts a rounding gap produced by the amount-first auto-fill flow (44.25 L @ ₹93.59, entered ₹4141.53)', async () => {
    getCurrentRate.mockResolvedValue({ rate: 93.59 });

    await expect(
      create({
        amount: 4141.53,
        litres: 44.25,
        paymentLines: [{ paymentType: PaymentType.CASH, amount: 4141.53, direction: PaymentDirection.IN }],
      }),
    ).resolves.toBeDefined();
  });

  it('still rejects an amount genuinely decoupled from litres × rate (the fraud case the check exists for)', async () => {
    getCurrentRate.mockResolvedValue({ rate: 50 });

    await expect(
      create({
        amount: 1,
        litres: 20,
        paymentLines: [{ paymentType: PaymentType.CASH, amount: 1, direction: PaymentDirection.IN }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
