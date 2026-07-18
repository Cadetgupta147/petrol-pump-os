import { Test, TestingModule } from '@nestjs/testing';
import { DashboardService } from './dashboard.service';
import { PrismaService } from '../prisma/prisma.service';

// Service-level test (CLAUDE.md: rule-heavy logic needs tests) — confirms
// the payment-type split returned by /dashboard/sales-summary is actually
// derived from BillPaymentLine rows (Section 5A split payments), not from a
// single field on Bill, and that split/OUT lines net out correctly once
// aggregated across multiple bills.
describe('DashboardService', () => {
  let service: DashboardService;
  let prisma: { bill: { findMany: jest.Mock }; tank: { findMany: jest.Mock } };

  beforeEach(async () => {
    prisma = {
      bill: { findMany: jest.fn() },
      tank: { findMany: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(DashboardService);
  });

  describe('getSalesSummary', () => {
    it('aggregates litres, amount, and a mixed-payment-type split across today\'s bills', async () => {
      prisma.bill.findMany.mockResolvedValue([
        {
          id: 'bill-1',
          amount: 450,
          litres: 10,
          paymentLines: [
            { paymentType: 'CASH', amount: 300, direction: 'IN' },
            { paymentType: 'UPI', amount: 150, direction: 'IN' },
          ],
        },
        {
          id: 'bill-2',
          amount: 950,
          litres: 20,
          paymentLines: [
            // overpaid by UPI, 50 cash change given back — net UPI 1000, net CASH -50
            { paymentType: 'UPI', amount: 1000, direction: 'IN' },
            { paymentType: 'CASH', amount: 50, direction: 'OUT' },
          ],
        },
        {
          id: 'bill-3',
          amount: 200,
          litres: 5,
          paymentLines: [{ paymentType: 'CREDIT', amount: 200, direction: 'IN' }],
        },
      ]);

      const result = await service.getSalesSummary();

      expect(prisma.bill.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ deletedAt: null }) as unknown,
        }),
      );
      expect(result.totalLitres).toBe(35);
      expect(result.totalAmount).toBe(1600);
      expect(result.byPaymentType).toEqual({
        CASH: 250, // 300 - 50
        CARD: 0,
        UPI: 1150, // 150 + 1000
        CREDIT: 200,
      });
    });

    it('returns zero totals when there are no bills today', async () => {
      prisma.bill.findMany.mockResolvedValue([]);

      const result = await service.getSalesSummary();

      expect(result.totalLitres).toBe(0);
      expect(result.totalAmount).toBe(0);
      expect(result.byPaymentType).toEqual({
        CASH: 0,
        CARD: 0,
        UPI: 0,
        CREDIT: 0,
      });
    });
  });

  describe('getTankStock', () => {
    it('returns an empty array when no tanks are seeded, rather than fabricating rows', async () => {
      prisma.tank.findMany.mockResolvedValue([]);

      const result = await service.getTankStock();

      expect(result).toEqual([]);
    });
  });
});
