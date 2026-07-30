import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EntryChannel, ItemCategory, ItemUnit, PaymentDirection, PaymentType } from '@prisma/client';
import { BillsService } from './bills.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreditConfigService } from '../credit-config/credit-config.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { RateMasterService } from '../rate-master/rate-master.service';
import { VehicleBlacklistService } from '../vehicle-blacklist/vehicle-blacklist.service';
import { LedgerPostingService } from '../ledger/ledger-posting.service';
import { TaxRateConfigService } from '../tax-rate-config/tax-rate-config.service';
import { CreateBillDto } from './dto/create-bill.dto';
import { runInTenantContext } from '../common/tenant-context';

// Extra (non-fuel) BillLineItem rows — Section (see prisma/schema.prisma's
// BillLineItem comment): GST is added ON TOP of quantity × rate (confirmed
// product decision, not MRP-inclusive), split CGST+SGST for an intra-state
// line or charged wholly as IGST for an inter-state one. Fuel itself never
// gets a tax field (already VAT-inclusive at the pump) — these tests only
// ever exercise the extra-items path, same harness/mocking pattern as
// bills-amount-rate.spec.ts. The default taxRate (when a line doesn't
// specify its own) comes from TaxRateConfigService.resolveTaxRateMap() — the
// same Section 17.22 config the sales/purchase register reads — keyed by
// itemName, not a second Item-scoped rate field.
describe('BillsService line items (tax calculation)', () => {
  let service: BillsService;
  let prisma: {
    bill: { create: jest.Mock; findFirst: jest.Mock };
    item: { findMany: jest.Mock };
    billAuditLog: { create: jest.Mock };
    creditLimitAlert: { create: jest.Mock };
    loyaltyTransaction: { create: jest.Mock };
    loyaltyConfig: { findUnique: jest.Mock };
    billNumberCounter: { update: jest.Mock };
    pump: { findUniqueOrThrow: jest.Mock };
    $transaction: jest.Mock;
  };
  let getCurrentRate: jest.Mock;
  let resolveTaxRateMap: jest.Mock;

  const baseDto: Omit<CreateBillDto, 'amount' | 'litres' | 'paymentLines'> = {
    vehicleNumber: 'KA01AB1234',
    productType: 'diesel',
    entryChannel: EntryChannel.WEB,
  };

  const lubricantItem = {
    id: 'item-oil',
    pumpId: 'default_pump',
    name: 'Engine Oil 1L',
    category: ItemCategory.LUBRICANT,
    unit: ItemUnit.PIECE,
    code: 'OIL-1L',
    isActive: true,
    createdAt: new Date(),
  };

  beforeEach(async () => {
    prisma = {
      bill: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'bill-1', ...data })),
        findFirst: jest.fn(),
      },
      item: { findMany: jest.fn().mockResolvedValue([lubricantItem]) },
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
    resolveTaxRateMap = jest.fn().mockResolvedValue({ 'Engine Oil 1L': 18 });

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
        { provide: TaxRateConfigService, useValue: { resolveTaxRateMap } },
      ],
    }).compile();

    service = module.get(BillsService);
  });

  function create(dto: Partial<CreateBillDto>) {
    return runInTenantContext({ pumpId: 'default_pump' }, () =>
      service.create({ ...baseDto, ...dto } as CreateBillDto, 'staff-1'),
    );
  }

  // Fuel: 10 L @ ₹90 = 900. Extra item: 2 × ₹200 = 400 base, 18% GST = 72,
  // split 36 CGST + 36 SGST (intra-state default). Grand total = 900 + 400 +
  // 72 = 1372.
  it('adds GST on top of the extra item and splits CGST/SGST for an intra-state line, defaulting taxRate from Item', async () => {
    const bill = await create({
      amount: 1372,
      litres: 10,
      lineItems: [{ itemId: 'item-oil', quantity: 2, rate: 200 }],
      paymentLines: [{ paymentType: PaymentType.CASH, amount: 1372, direction: PaymentDirection.IN }],
    });

    expect(bill.itemsSubtotal).toBe(400);
    expect(bill.itemsTaxTotal).toBe(72);
    const created = prisma.bill.create.mock.calls[0][0].data;
    expect(created.lineItems.create).toEqual([
      expect.objectContaining({
        pumpId: 'default_pump',
        itemId: 'item-oil',
        itemCode: 'OIL-1L',
        itemName: 'Engine Oil 1L',
        quantity: 2,
        rate: 200,
        amount: 400,
        isInterstate: false,
        taxRate: 18,
        cgstAmount: 36,
        sgstAmount: 36,
        igstAmount: 0,
        lineTotal: 472,
      }),
    ]);
  });

  it('charges the full rate as IGST for an inter-state line instead of splitting CGST/SGST', async () => {
    const bill = await create({
      amount: 1372,
      litres: 10,
      lineItems: [{ itemId: 'item-oil', quantity: 2, rate: 200, isInterstate: true }],
      paymentLines: [{ paymentType: PaymentType.CASH, amount: 1372, direction: PaymentDirection.IN }],
    });

    const created = prisma.bill.create.mock.calls[0][0].data;
    expect(created.lineItems.create[0]).toEqual(
      expect.objectContaining({ cgstAmount: 0, sgstAmount: 0, igstAmount: 72 }),
    );
    expect(bill.itemsTaxTotal).toBe(72);
  });

  it('lets a per-line taxRate override the Item default', async () => {
    // 2 × ₹200 = 400 base, 12% GST = 48, split 24/24.
    await create({
      amount: 1348,
      litres: 10,
      lineItems: [{ itemId: 'item-oil', quantity: 2, rate: 200, taxRate: 12 }],
      paymentLines: [{ paymentType: PaymentType.CASH, amount: 1348, direction: PaymentDirection.IN }],
    });

    const created = prisma.bill.create.mock.calls[0][0].data;
    expect(created.lineItems.create[0]).toEqual(
      expect.objectContaining({ taxRate: 12, cgstAmount: 24, sgstAmount: 24, lineTotal: 448 }),
    );
  });

  it('rejects an amount that omits the extra item / its tax (never trust the frontend for money fields)', async () => {
    await expect(
      create({
        // Missing the 400 + 72 the line item actually adds.
        amount: 900,
        litres: 10,
        lineItems: [{ itemId: 'item-oil', quantity: 2, rate: 200 }],
        paymentLines: [{ paymentType: PaymentType.CASH, amount: 900, direction: PaymentDirection.IN }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an itemId that does not reference a real Item', async () => {
    prisma.item.findMany.mockResolvedValue([]);
    await expect(
      create({
        amount: 1372,
        litres: 10,
        lineItems: [{ itemId: 'item-ghost', quantity: 2, rate: 200 }],
        paymentLines: [{ paymentType: PaymentType.CASH, amount: 1372, direction: PaymentDirection.IN }],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('requires itemName when no itemId is given (a one-off item not registered in Item Master)', async () => {
    await expect(
      create({
        amount: 1000,
        litres: 10,
        lineItems: [{ quantity: 1, rate: 100 }],
        paymentLines: [{ paymentType: PaymentType.CASH, amount: 1000, direction: PaymentDirection.IN }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts a free-typed line item (no itemId) with its own name/taxRate, no Item lookup needed', async () => {
    // 1 × ₹100 = 100 base, 5% GST = 5, split 2.5/2.5. Fuel 900 + 100 + 5 = 1005.
    const bill = await create({
      amount: 1005,
      litres: 10,
      lineItems: [{ itemName: 'Wiper fluid', quantity: 1, rate: 100, taxRate: 5 }],
      paymentLines: [{ paymentType: PaymentType.CASH, amount: 1005, direction: PaymentDirection.IN }],
    });

    expect(bill.itemsSubtotal).toBe(100);
    expect(bill.itemsTaxTotal).toBe(5);
    const created = prisma.bill.create.mock.calls[0][0].data;
    expect(created.lineItems.create[0]).toEqual(
      expect.objectContaining({ itemId: undefined, itemName: 'Wiper fluid', cgstAmount: 2.5, sgstAmount: 2.5 }),
    );
  });

  it('stays backward-compatible: omitting lineItems entirely leaves itemsSubtotal/itemsTaxTotal at 0 and creates no BillLineItem rows', async () => {
    const bill = await create({
      amount: 900,
      litres: 10,
      paymentLines: [{ paymentType: PaymentType.CASH, amount: 900, direction: PaymentDirection.IN }],
    });

    expect(bill.itemsSubtotal).toBe(0);
    expect(bill.itemsTaxTotal).toBe(0);
    const created = prisma.bill.create.mock.calls[0][0].data;
    expect(created.lineItems.create).toEqual([]);
  });
});
