import { Test, TestingModule } from '@nestjs/testing';
import { SalesPurchaseRegisterService } from './sales-purchase-register.service';
import { PrismaService } from '../prisma/prisma.service';
import { TaxRateConfigService } from '../tax-rate-config/tax-rate-config.service';

// Section 12/17.22 — rule-heavy per CLAUDE.md (money-adjacent tax
// computation). Covers: a configured product gets taxAmount computed
// additively on `amount`; an unconfigured product shows null (not 0, not
// silently omitted); totals sum only the configured rows.
describe('SalesPurchaseRegisterService', () => {
  let service: SalesPurchaseRegisterService;
  let prisma: {
    bill: { findMany: jest.Mock };
    purchaseEntry: { findMany: jest.Mock };
  };
  let taxRateConfigService: { resolveTaxRateMap: jest.Mock };

  beforeEach(async () => {
    prisma = {
      bill: { findMany: jest.fn().mockResolvedValue([]) },
      purchaseEntry: { findMany: jest.fn().mockResolvedValue([]) },
    };
    taxRateConfigService = { resolveTaxRateMap: jest.fn().mockResolvedValue({}) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesPurchaseRegisterService,
        { provide: PrismaService, useValue: prisma },
        { provide: TaxRateConfigService, useValue: taxRateConfigService },
      ],
    }).compile();

    service = module.get(SalesPurchaseRegisterService);
  });

  it('computes taxAmount additively on amount for a configured product', async () => {
    prisma.bill.findMany.mockResolvedValue([
      {
        id: 'bill-1',
        timestamp: new Date('2026-07-20T00:00:00Z'),
        customer: null,
        customerName: 'Walk-in',
        productType: 'lubricant',
        litres: 2,
        rateApplied: 500,
        amount: 1000,
      },
    ]);
    taxRateConfigService.resolveTaxRateMap.mockResolvedValue({ lubricant: 18 });

    const result = await service.getRegister({ from: '2026-07-01', to: '2026-07-31' });

    expect(result.salesRegister[0].taxRatePercent).toBe(18);
    expect(result.salesRegister[0].taxAmount).toBeCloseTo(180, 5);
    expect(result.salesTotals.taxAmount).toBeCloseTo(180, 5);
  });

  it('shows null (not 0) for a product with no configured rate', async () => {
    prisma.bill.findMany.mockResolvedValue([
      {
        id: 'bill-1',
        timestamp: new Date('2026-07-20T00:00:00Z'),
        customer: null,
        customerName: 'Walk-in',
        productType: 'petrol',
        litres: 10,
        rateApplied: 100,
        amount: 1000,
      },
    ]);
    taxRateConfigService.resolveTaxRateMap.mockResolvedValue({});

    const result = await service.getRegister({ from: '2026-07-01', to: '2026-07-31' });

    expect(result.salesRegister[0].taxRatePercent).toBeNull();
    expect(result.salesRegister[0].taxAmount).toBeNull();
    expect(result.salesTotals.taxAmount).toBe(0);
  });

  it('applies the same configured-rate logic to the purchase register', async () => {
    prisma.purchaseEntry.findMany.mockResolvedValue([
      {
        createdAt: new Date('2026-07-20T00:00:00Z'),
        supplierName: 'ACME Lubricants',
        invoiceNo: 'INV-1',
        productType: 'lubricant',
        quantityLitres: 5,
        ratePerLitre: 200,
        amount: 1000,
      },
    ]);
    taxRateConfigService.resolveTaxRateMap.mockResolvedValue({ lubricant: 18 });

    const result = await service.getRegister({ from: '2026-07-01', to: '2026-07-31' });

    expect(result.purchaseRegister[0].taxAmount).toBeCloseTo(180, 5);
    expect(result.purchaseTotals.taxAmount).toBeCloseTo(180, 5);
  });

  it('always includes taxModelingGap explaining the remaining limitation', async () => {
    const result = await service.getRegister({ from: '2026-07-01', to: '2026-07-31' });

    expect(result.taxModelingGap).toEqual(expect.any(String));
  });
});
