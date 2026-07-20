import { Test, TestingModule } from '@nestjs/testing';
import { CreditAgingService } from './credit-aging.service';
import { PrismaService } from '../prisma/prisma.service';

// Section 12 — Credit Aging Report. The FIFO-allocation/bucket-boundary
// logic itself is covered exhaustively in credit-aging.util.spec.ts; this
// spec covers the service's own responsibility — turning per-customer
// bill/payment rows into CreditLedgerEvents correctly (CREDIT-line netting)
// and the report-level sort order.
describe('CreditAgingService', () => {
  let service: CreditAgingService;
  let prisma: { customer: { findMany: jest.Mock } };

  const asOf = new Date('2026-07-21T00:00:00Z');
  const daysAgo = (n: number) =>
    new Date(asOf.getTime() - n * 24 * 60 * 60 * 1000);

  beforeEach(async () => {
    prisma = { customer: { findMany: jest.fn() } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CreditAgingService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(CreditAgingService);
  });

  it('nets only CREDIT-type payment lines for a bill (cash/upi/card lines on the same bill are ignored)', async () => {
    prisma.customer.findMany.mockResolvedValue([
      {
        id: 'cust-1',
        name: 'Ramesh',
        phone: '9999999999',
        creditLimit: 5000,
        bills: [
          {
            timestamp: daysAgo(20),
            paymentLines: [
              { paymentType: 'CASH', amount: 500, direction: 'IN' },
              { paymentType: 'CREDIT', amount: 300, direction: 'IN' },
            ],
          },
        ],
        payments: [],
      },
    ]);

    const report = await service.getReport(asOf);
    const row = report.customers[0];

    expect(row.totalOutstanding).toBe(300); // only the CREDIT line counts
    expect(row.bucket15to30).toBe(300); // 20 days old
    expect(row.hasOutstandingBalance).toBe(true);
  });

  it('nets a Payment against the customer\'s oldest open CREDIT bill (FIFO)', async () => {
    prisma.customer.findMany.mockResolvedValue([
      {
        id: 'cust-1',
        name: 'Ramesh',
        phone: null,
        creditLimit: 5000,
        bills: [
          {
            timestamp: daysAgo(40),
            paymentLines: [
              { paymentType: 'CREDIT', amount: 1000, direction: 'IN' },
            ],
          },
        ],
        payments: [{ createdAt: daysAgo(10), amount: 1000 }],
      },
    ]);

    const report = await service.getReport(asOf);
    const row = report.customers[0];

    expect(row.totalOutstanding).toBe(0);
    expect(row.hasOutstandingBalance).toBe(false);
    expect(row.oldestUnpaidBillDate).toBeNull();
  });

  it('sorts customers with an outstanding balance before fully-settled ones, largest first', async () => {
    prisma.customer.findMany.mockResolvedValue([
      {
        id: 'settled',
        name: 'Settled Customer',
        phone: null,
        creditLimit: 1000,
        bills: [
          {
            timestamp: daysAgo(5),
            paymentLines: [
              { paymentType: 'CREDIT', amount: 200, direction: 'IN' },
            ],
          },
        ],
        payments: [{ createdAt: daysAgo(1), amount: 200 }],
      },
      {
        id: 'small-owing',
        name: 'Small Owing',
        phone: null,
        creditLimit: 1000,
        bills: [
          {
            timestamp: daysAgo(5),
            paymentLines: [
              { paymentType: 'CREDIT', amount: 100, direction: 'IN' },
            ],
          },
        ],
        payments: [],
      },
      {
        id: 'big-owing',
        name: 'Big Owing',
        phone: null,
        creditLimit: 5000,
        bills: [
          {
            timestamp: daysAgo(40),
            paymentLines: [
              { paymentType: 'CREDIT', amount: 900, direction: 'IN' },
            ],
          },
        ],
        payments: [],
      },
    ]);

    const report = await service.getReport(asOf);

    expect(report.customers.map((c) => c.customerId)).toEqual([
      'big-owing',
      'small-owing',
      'settled',
    ]);
  });

  it('aggregates bucket totals across all customers', async () => {
    prisma.customer.findMany.mockResolvedValue([
      {
        id: 'cust-1',
        name: 'A',
        phone: null,
        creditLimit: 1000,
        bills: [
          {
            timestamp: daysAgo(5),
            paymentLines: [
              { paymentType: 'CREDIT', amount: 100, direction: 'IN' },
            ],
          },
        ],
        payments: [],
      },
      {
        id: 'cust-2',
        name: 'B',
        phone: null,
        creditLimit: 1000,
        bills: [
          {
            timestamp: daysAgo(45),
            paymentLines: [
              { paymentType: 'CREDIT', amount: 250, direction: 'IN' },
            ],
          },
        ],
        payments: [],
      },
    ]);

    const report = await service.getReport(asOf);

    expect(report.totals).toEqual({
      bucket0to15: 100,
      bucket15to30: 0,
      bucket30Plus: 250,
      total: 350,
    });
  });

  it('an untouched-by-credit customer set returns an empty report', async () => {
    prisma.customer.findMany.mockResolvedValue([]);

    const report = await service.getReport(asOf);

    expect(report.customers).toEqual([]);
    expect(report.totals).toEqual({
      bucket0to15: 0,
      bucket15to30: 0,
      bucket30Plus: 0,
      total: 0,
    });
  });
});
