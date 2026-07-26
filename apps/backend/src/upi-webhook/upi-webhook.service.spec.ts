import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, UpiMerchantProvider } from '@prisma/client';
import { UpiWebhookService } from './upi-webhook.service';
import { PrismaService } from '../prisma/prisma.service';
import { ShiftSalesService } from '../shift-sales/shift-sales.service';
import { UpiCaptureConfigService } from '../upi-capture-config/upi-capture-config.service';
import * as sigUtil from './verify-webhook-signature.util';

const PUMP_ID = 'pump-1';

const ENABLED_PHONEPE_CONFIG = {
  pumpId: PUMP_ID,
  autoCaptureEnabled: true,
  provider: UpiMerchantProvider.PHONEPE,
  phonePeWebhookUsername: 'dealer-user',
  phonePeWebhookPassword: 'dealer-pass',
  paytmMerchantKey: null,
};

// Section 8A.3 — the security-sensitive part of Feature B (CLAUDE.md:
// webhook handlers must be idempotent and signature-verified — both are
// tested here, plus the variance recompute math that a bad
// signature/idempotency bug would otherwise silently corrupt). Real crypto
// for verifyPhonePeSignature/verifyPaytmSignature is covered separately in
// verify-webhook-signature.util.spec.ts — here those are mocked so this
// suite can focus on pump/config resolution, dispatch, idempotency, and
// shift matching without re-deriving real checksums for every case.
describe('UpiWebhookService', () => {
  let service: UpiWebhookService;

  let prisma: {
    $transaction: jest.Mock;
    pump: { findUnique: jest.Mock };
    upiWebhookEvent: { create: jest.Mock; update: jest.Mock };
    meterReading: { findFirst: jest.Mock; findMany: jest.Mock };
  };
  let shiftSalesService: { incrementUpiForShift: jest.Mock };
  let upiCaptureConfigService: { findByPumpId: jest.Mock };

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn(),
      pump: {
        findUnique: jest.fn().mockResolvedValue({ id: PUMP_ID, active: true }),
      },
      upiWebhookEvent: { create: jest.fn(), update: jest.fn() },
      meterReading: { findFirst: jest.fn(), findMany: jest.fn() },
    };
    shiftSalesService = { incrementUpiForShift: jest.fn() };
    upiCaptureConfigService = {
      findByPumpId: jest.fn().mockResolvedValue(ENABLED_PHONEPE_CONFIG),
    };

    jest.spyOn(sigUtil, 'verifyPhonePeSignature').mockReturnValue(true);
    jest.spyOn(sigUtil, 'verifyPaytmSignature').mockReturnValue(true);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UpiWebhookService,
        { provide: PrismaService, useValue: prisma },
        { provide: ShiftSalesService, useValue: shiftSalesService },
        { provide: UpiCaptureConfigService, useValue: upiCaptureConfigService },
      ],
    }).compile();

    service = module.get(UpiWebhookService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('pump + capture-config resolution', () => {
    it('rejects with 404 when the :pumpId path param does not match a real Pump', async () => {
      prisma.pump.findUnique.mockResolvedValue(null);

      await expect(
        service.handleWebhook('no-such-pump', undefined, 'sig', { providerEventId: 'e', amount: 500 }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects with 404 when the pump exists but is inactive', async () => {
      prisma.pump.findUnique.mockResolvedValue({ id: PUMP_ID, active: false });

      await expect(
        service.handleWebhook(PUMP_ID, undefined, 'sig', { providerEventId: 'e', amount: 500 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects with 403 when this pump has no UpiCaptureConfig at all', async () => {
      upiCaptureConfigService.findByPumpId.mockResolvedValue(null);

      await expect(
        service.handleWebhook(PUMP_ID, undefined, 'sig', { providerEventId: 'e', amount: 500 }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects with 403 when autoCaptureEnabled is false (dealer opted for manual entry)', async () => {
      upiCaptureConfigService.findByPumpId.mockResolvedValue({
        ...ENABLED_PHONEPE_CONFIG,
        autoCaptureEnabled: false,
      });

      await expect(
        service.handleWebhook(PUMP_ID, undefined, 'sig', { providerEventId: 'e', amount: 500 }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('provider dispatch', () => {
    it('verifies against PhonePe using this pump\'s stored username/password', async () => {
      prisma.$transaction.mockImplementation(async (cb) =>
        cb({
          upiWebhookEvent: { create: jest.fn().mockResolvedValue({ id: 'e1' }), update: jest.fn() },
          meterReading: { findMany: jest.fn().mockResolvedValue([]) },
        }),
      );

      await service.handleWebhook(PUMP_ID, undefined, 'auth-header', {
        providerEventId: 'evt-1',
        amount: 500,
      });

      expect(sigUtil.verifyPhonePeSignature).toHaveBeenCalledWith(
        'auth-header',
        'dealer-user',
        'dealer-pass',
      );
      expect(sigUtil.verifyPaytmSignature).not.toHaveBeenCalled();
    });

    it('verifies against Paytm using this pump\'s stored merchant key', async () => {
      upiCaptureConfigService.findByPumpId.mockResolvedValue({
        pumpId: PUMP_ID,
        autoCaptureEnabled: true,
        provider: UpiMerchantProvider.PAYTM,
        phonePeWebhookUsername: null,
        phonePeWebhookPassword: null,
        paytmMerchantKey: 'testmerchantkey1',
      });
      prisma.$transaction.mockImplementation(async (cb) =>
        cb({
          upiWebhookEvent: { create: jest.fn().mockResolvedValue({ id: 'e1' }), update: jest.fn() },
          meterReading: { findMany: jest.fn().mockResolvedValue([]) },
        }),
      );
      const payload = { providerEventId: 'evt-1', amount: 500, CHECKSUMHASH: 'abc' };

      await service.handleWebhook(PUMP_ID, undefined, undefined, payload);

      expect(sigUtil.verifyPaytmSignature).toHaveBeenCalledWith(payload, 'testmerchantkey1');
      expect(sigUtil.verifyPhonePeSignature).not.toHaveBeenCalled();
    });

    it('rejects with 401 when the dispatched verifier returns false, WITHOUT touching the DB', async () => {
      jest.spyOn(sigUtil, 'verifyPhonePeSignature').mockReturnValue(false);

      await expect(
        service.handleWebhook(PUMP_ID, undefined, 'wrong', { providerEventId: 'e', amount: 500 }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('payload validation (after signature passes)', () => {
    it('rejects a missing providerEventId', async () => {
      await expect(
        service.handleWebhook(PUMP_ID, undefined, 'sig', { amount: 500 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a missing/invalid amount', async () => {
      await expect(
        service.handleWebhook(PUMP_ID, undefined, 'sig', {
          providerEventId: 'evt-1',
          amount: 'not-a-number',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('idempotency', () => {
    it('treats a duplicate providerEventId (P2002 on create) as a no-op success, not an error', async () => {
      prisma.$transaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      const result = await service.handleWebhook(PUMP_ID, undefined, 'sig', {
        providerEventId: 'evt-dup',
        amount: 500,
      });

      expect(result).toEqual({ status: 'duplicate', providerEventId: 'evt-dup' });
      // Never reaches ShiftSalesService — the whole transaction (including
      // the would-be increment) rolled back, so nothing double-counts.
      expect(shiftSalesService.incrementUpiForShift).not.toHaveBeenCalled();
    });

    it('re-throws non-P2002 errors instead of swallowing them as duplicates', async () => {
      prisma.$transaction.mockRejectedValue(new Error('unexpected db error'));

      await expect(
        service.handleWebhook(PUMP_ID, undefined, 'sig', { providerEventId: 'evt-1', amount: 500 }),
      ).rejects.toThrow('unexpected db error');
    });
  });

  describe('shift matching + variance recompute delegation', () => {
    it('matches the payload nozzleId to the open shift and increments that shift\'s ShiftSalesSummary', async () => {
      const payload = { providerEventId: 'evt-2', amount: 500, nozzleId: 'n1' };
      const openShift = { id: 'shift-1', nozzleId: 'n1' };
      const txUpiWebhookEvent = {
        create: jest.fn().mockResolvedValue({ id: 'event-2' }),
        update: jest.fn().mockResolvedValue({}),
      };
      const txMeterReading = { findFirst: jest.fn().mockResolvedValue(openShift) };
      prisma.$transaction.mockImplementation(async (cb) =>
        cb({ upiWebhookEvent: txUpiWebhookEvent, meterReading: txMeterReading }),
      );
      shiftSalesService.incrementUpiForShift.mockResolvedValue({
        walkInUpiCollected: 1500,
        variance: 3500,
      });

      const result = await service.handleWebhook(PUMP_ID, undefined, 'sig', payload);

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
      expect(result).toEqual({ status: 'processed', eventId: 'event-2', matchedShiftId: 'shift-1' });
    });

    it('leaves the event unmatched when no nozzleId is given and more than one shift is open at that time', async () => {
      const payload = { providerEventId: 'evt-3', amount: 500 };
      const txUpiWebhookEvent = {
        create: jest.fn().mockResolvedValue({ id: 'event-3' }),
        update: jest.fn(),
      };
      const txMeterReading = {
        findMany: jest.fn().mockResolvedValue([{ id: 'shift-1' }, { id: 'shift-2' }]), // ambiguous
      };
      prisma.$transaction.mockImplementation(async (cb) =>
        cb({ upiWebhookEvent: txUpiWebhookEvent, meterReading: txMeterReading }),
      );

      const result = await service.handleWebhook(PUMP_ID, undefined, 'sig', payload);

      expect(txUpiWebhookEvent.update).not.toHaveBeenCalled();
      expect(shiftSalesService.incrementUpiForShift).not.toHaveBeenCalled();
      expect(result).toEqual({ status: 'processed', eventId: 'event-3', matchedShiftId: null });
    });
  });
});
