import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { RateMasterService } from './rate-master.service';
import { PrismaService } from '../prisma/prisma.service';

// Section 7.4 — rule-heavy logic per CLAUDE.md ("rate resolution" — the
// server-side source of truth for Bill.rateApplied, CLAUDE.md's "never trust
// the frontend" hard rule). Covers: resolving the latest
// effectiveFrom <= asOf row, ignoring future-dated rates, and the hard 404
// when nothing is configured for a product.
describe('RateMasterService', () => {
  let service: RateMasterService;
  let prisma: {
    rateHistory: { create: jest.Mock; findMany: jest.Mock; findFirst: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      rateHistory: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RateMasterService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(RateMasterService);
  });

  describe('getCurrentRate', () => {
    it('resolves the latest effectiveFrom <= asOf row for the product', async () => {
      const asOf = new Date('2026-07-20T00:00:00Z');
      const row = {
        id: 'rh-1',
        productType: 'petrol',
        rate: 100,
        effectiveFrom: new Date('2026-07-15T00:00:00Z'),
      };
      prisma.rateHistory.findFirst.mockResolvedValue(row);

      const result = await service.getCurrentRate('petrol', asOf);

      expect(prisma.rateHistory.findFirst).toHaveBeenCalledWith({
        where: { productType: 'petrol', effectiveFrom: { lte: asOf } },
        orderBy: { effectiveFrom: 'desc' },
      });
      expect(result).toEqual(row);
    });

    it('ignores future-dated rates — findFirst query itself excludes them via effectiveFrom lte asOf', async () => {
      // Simulates the DB correctly excluding a future-dated row: only the
      // past row is ever returned by the where-filtered query.
      const asOf = new Date('2026-07-20T00:00:00Z');
      const pastRow = {
        id: 'rh-past',
        productType: 'diesel',
        rate: 90,
        effectiveFrom: new Date('2026-07-01T00:00:00Z'),
      };
      prisma.rateHistory.findFirst.mockResolvedValue(pastRow);

      const result = await service.getCurrentRate('diesel', asOf);

      expect(result).toEqual(pastRow);
      expect(prisma.rateHistory.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            effectiveFrom: { lte: asOf },
          }) as unknown,
        }),
      );
    });

    it('throws NotFoundException when no Rate Master entry exists for the product', async () => {
      prisma.rateHistory.findFirst.mockResolvedValue(null);

      await expect(service.getCurrentRate('petrol')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('defaults asOf to now when not provided', async () => {
      prisma.rateHistory.findFirst.mockResolvedValue({
        id: 'rh-1',
        productType: 'petrol',
        rate: 100,
        effectiveFrom: new Date('2020-01-01T00:00:00Z'),
      });

      await service.getCurrentRate('petrol');

      const findFirstCalls = prisma.rateHistory.findFirst.mock
        .calls as unknown[][];
      const call = findFirstCalls[0][0] as {
        where: { effectiveFrom: { lte: Date } };
      };
      expect(call.where.effectiveFrom.lte).toBeInstanceOf(Date);
    });
  });

  describe('findAll', () => {
    it('orders by effectiveFrom desc, filtered by productType when provided', async () => {
      prisma.rateHistory.findMany.mockResolvedValue([]);

      await service.findAll('petrol');

      expect(prisma.rateHistory.findMany).toHaveBeenCalledWith({
        where: { productType: 'petrol' },
        orderBy: { effectiveFrom: 'desc' },
      });
    });

    it('omits the where filter entirely when productType is not provided', async () => {
      prisma.rateHistory.findMany.mockResolvedValue([]);

      await service.findAll();

      expect(prisma.rateHistory.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { effectiveFrom: 'desc' },
      });
    });
  });
});
