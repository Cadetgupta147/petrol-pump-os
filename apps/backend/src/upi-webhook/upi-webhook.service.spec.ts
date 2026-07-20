import { createHmac } from 'crypto';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { UpiWebhookService } from './upi-webhook.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { ShiftSalesService } from '../shift-sales/shift-sales.service';

const SECRET = 'test-secret';

function sign(body: object): { rawBody: Buffer; signature: string } {
  const rawBody = Buffer.from(JSON.stringify(body), 'utf8');
  const signature = createHmac('sha256', SECRET).update(rawBody).digest('hex');
  return { rawBody, signature };
}

// Section 8A.3 — the security-sensitive part of Feature B (CLAUDE.md:
// webhook handlers must be idempotent and signature-verified — both are
// tested here explicitly, plus the variance recompute math that a bad
// signature/idempotency bug would otherwise silently corrupt).
describe('UpiWebhookService', () => {
  let service: UpiWebhookService;

  let prisma: {
    $transaction: jest.Mock;
    upiWebhookEvent: { create: jest.Mock; update: jest.Mock };
    meterReading: { findFirst: jest.Mock; findMany: jest.Mock };
  };
  let config: { get: jest.Mock };
  let shiftSalesService: { incrementUpiForShift: jest.Mock };

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn(),
      upiWebhookEvent: { create: jest.fn(), update: jest.fn() },
      meterReading: { findFirst: jest.fn(), findMany: jest.fn() },
    };
    config = {
      get: jest.fn((key: string) => {
        if (key === 'UPI_WEBHOOK_SIGNING_SECRET') return SECRET;
        if (key === 'UPI_MERCHANT_PROVIDER') return 'phonepe';
        return undefined;
      }),
    };
    shiftSalesService = { incrementUpiForShift: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UpiWebhookService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: config },
        { provide: ShiftSalesService, useValue: shiftSalesService },
      ],
    }).compile();

    service = module.get(UpiWebhookService);
  });

  describe('signature verification', () => {
    it('rejects with 401 when the signature header is missing, WITHOUT touching the DB', async () => {
      const payload = { providerEventId: 'evt-1', amount: 500 };
      const { rawBody } = sign(payload);

      await expect(
        service.handleWebhook(rawBody, undefined, payload),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects with 401 when the signature does not match the raw body', async () => {
      const payload = { providerEventId: 'evt-1', amount: 500 };
      const { rawBody } = sign(payload);

      await expect(
        service.handleWebhook(rawBody, 'not-the-real-signature', payload),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects with 401 when UPI_WEBHOOK_SIGNING_SECRET is not configured (fails closed)', async () => {
      config.get.mockReturnValue(undefined);
      const payload = { providerEventId: 'evt-1', amount: 500 };
      const { rawBody, signature } = sign(payload);

      await expect(
        service.handleWebhook(rawBody, signature, payload),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('accepts a correctly signed payload', async () => {
      const payload = { providerEventId: 'evt-1', amount: 500 };
      const { rawBody, signature } = sign(payload);
      prisma.$transaction.mockImplementation(async (cb) =>
        cb({
          upiWebhookEvent: {
            create: jest.fn().mockResolvedValue({ id: 'event-1' }),
            update: jest.fn(),
          },
          meterReading: { findMany: jest.fn().mockResolvedValue([]) },
        }),
      );

      const result = await service.handleWebhook(rawBody, signature, payload);
      expect(result.status).toBe('processed');
    });
  });

  describe('payload validation (after signature passes)', () => {
    it('rejects a missing providerEventId', async () => {
      const payload = { amount: 500 };
      const { rawBody, signature } = sign(payload);

      await expect(
        service.handleWebhook(rawBody, signature, payload),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a missing/invalid amount', async () => {
      const payload = { providerEventId: 'evt-1', amount: 'not-a-number' };
      const { rawBody, signature } = sign(payload);

      await expect(
        service.handleWebhook(rawBody, signature, payload),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('idempotency', () => {
    it('treats a duplicate providerEventId (P2002 on create) as a no-op success, not an error', async () => {
      const payload = { providerEventId: 'evt-dup', amount: 500 };
      const { rawBody, signature } = sign(payload);

      prisma.$transaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      const result = await service.handleWebhook(rawBody, signature, payload);

      expect(result).toEqual({ status: 'duplicate', providerEventId: 'evt-dup' });
      // Never reaches ShiftSalesService — the whole transaction (including
      // the would-be increment) rolled back, so nothing double-counts.
      expect(shiftSalesService.incrementUpiForShift).not.toHaveBeenCalled();
    });

    it('re-throws non-P2002 errors instead of swallowing them as duplicates', async () => {
      const payload = { providerEventId: 'evt-1', amount: 500 };
      const { rawBody, signature } = sign(payload);
      prisma.$transaction.mockRejectedValue(new Error('unexpected db error'));

      await expect(
        service.handleWebhook(rawBody, signature, payload),
      ).rejects.toThrow('unexpected db error');
    });
  });

  describe('shift matching + variance recompute delegation', () => {
    it('matches the payload nozzleId to the open shift and increments that shift\'s ShiftSalesSummary', async () => {
      const payload = {
        providerEventId: 'evt-2',
        amount: 500,
        nozzleId: 'n1',
      };
      const { rawBody, signature } = sign(payload);

      const openShift = { id: 'shift-1', nozzleId: 'n1' };
      const txUpiWebhookEvent = {
        create: jest.fn().mockResolvedValue({ id: 'event-2' }),
        update: jest.fn().mockResolvedValue({}),
      };
      const txMeterReading = {
        findFirst: jest.fn().mockResolvedValue(openShift),
      };
      prisma.$transaction.mockImplementation(async (cb) =>
        cb({
          upiWebhookEvent: txUpiWebhookEvent,
          meterReading: txMeterReading,
        }),
      );
      shiftSalesService.incrementUpiForShift.mockResolvedValue({
        walkInUpiCollected: 1500,
        variance: 3500,
      });

      const result = await service.handleWebhook(rawBody, signature, payload);

      expect(txMeterReading.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ nozzleId: 'n1' }) }),
      );
      expect(txUpiWebhookEvent.update).toHaveBeenCalledWith({
        where: { id: 'event-2' },
        data: { matchedShiftId: 'shift-1', matchedNozzleId: 'n1' },
      });
      expect(shiftSalesService.incrementUpiForShift).toHaveBeenCalledWith(
        expect.anything(),
        'shift-1',
        500,
      );
      expect(result).toEqual({
        status: 'processed',
        eventId: 'event-2',
        matchedShiftId: 'shift-1',
      });
    });

    it('leaves the event unmatched when no nozzleId is given and more than one shift is open at that time', async () => {
      const payload = { providerEventId: 'evt-3', amount: 500 };
      const { rawBody, signature } = sign(payload);

      const txUpiWebhookEvent = {
        create: jest.fn().mockResolvedValue({ id: 'event-3' }),
        update: jest.fn(),
      };
      const txMeterReading = {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'shift-1' }, { id: 'shift-2' }]), // ambiguous
      };
      prisma.$transaction.mockImplementation(async (cb) =>
        cb({
          upiWebhookEvent: txUpiWebhookEvent,
          meterReading: txMeterReading,
        }),
      );

      const result = await service.handleWebhook(rawBody, signature, payload);

      expect(txUpiWebhookEvent.update).not.toHaveBeenCalled();
      expect(shiftSalesService.incrementUpiForShift).not.toHaveBeenCalled();
      expect(result).toEqual({
        status: 'processed',
        eventId: 'event-3',
        matchedShiftId: null,
      });
    });
  });
});
