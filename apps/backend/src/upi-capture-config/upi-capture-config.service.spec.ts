import { randomBytes } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { UpiMerchantProvider } from '@prisma/client';
import { UpiCaptureConfigService } from './upi-capture-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { runInTenantContext } from '../common/tenant-context';
import { decryptCredential, encryptCredential } from '../common/credential-encryption.util';

// Section 8A.3 follow-up (CLAUDE.md: money-touching + rule-heavy logic needs
// tests) — covers both the encrypt-at-rest round trip (the whole reason
// this service exists in its current form) and the "can't enable
// auto-capture without credentials" guard, which was previously untested.
describe('UpiCaptureConfigService', () => {
  let service: UpiCaptureConfigService;
  let prisma: {
    upiCaptureConfig: { upsert: jest.Mock; update: jest.Mock; findUnique: jest.Mock };
  };

  const PUMP_ID = 'pump-1';

  beforeAll(() => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  });

  beforeEach(async () => {
    prisma = {
      upiCaptureConfig: { upsert: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [UpiCaptureConfigService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(UpiCaptureConfigService);
  });

  function baseRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'cfg-1',
      pumpId: PUMP_ID,
      autoCaptureEnabled: false,
      provider: null,
      phonePeWebhookUsername: null,
      phonePeWebhookPassword: null,
      paytmMerchantKey: null,
      updatedAt: new Date('2026-07-20T00:00:00.000Z'),
      ...overrides,
    };
  }

  describe('getRaw / findByPumpId — decrypt on read', () => {
    it('decrypts an encrypted row back to plaintext', async () => {
      const encryptedRow = baseRow({
        phonePeWebhookUsername: encryptCredential('dealer-user'),
        phonePeWebhookPassword: encryptCredential('dealer-pass'),
      });
      prisma.upiCaptureConfig.upsert.mockResolvedValue(encryptedRow);

      const result = await runInTenantContext({ pumpId: PUMP_ID }, () => service.getRaw());

      expect(result.phonePeWebhookUsername).toBe('dealer-user');
      expect(result.phonePeWebhookPassword).toBe('dealer-pass');
    });

    it('findByPumpId decrypts too, and passes null through when no row exists', async () => {
      prisma.upiCaptureConfig.findUnique.mockResolvedValue(
        baseRow({ paytmMerchantKey: encryptCredential('testmerchantkey1') }),
      );
      const found = await service.findByPumpId(PUMP_ID);
      expect(found?.paytmMerchantKey).toBe('testmerchantkey1');

      prisma.upiCaptureConfig.findUnique.mockResolvedValue(null);
      expect(await service.findByPumpId('no-such-pump')).toBeNull();
    });
  });

  describe('update — encrypt on write', () => {
    it('never sends plaintext credentials to prisma, and the stored value decrypts back correctly', async () => {
      prisma.upiCaptureConfig.upsert.mockResolvedValue(baseRow());
      prisma.upiCaptureConfig.update.mockImplementation(({ data }) => ({ ...baseRow(), ...data }));

      const result = await runInTenantContext({ pumpId: PUMP_ID }, () =>
        service.update({
          provider: UpiMerchantProvider.PHONEPE,
          phonePeWebhookUsername: 'dealer-user',
          phonePeWebhookPassword: 'dealer-pass',
        }),
      );

      const writtenData = prisma.upiCaptureConfig.update.mock.calls[0][0].data;
      expect(writtenData.phonePeWebhookUsername).not.toBe('dealer-user');
      expect(writtenData.phonePeWebhookUsername).toMatch(/^v1:/);
      expect(decryptCredential(writtenData.phonePeWebhookUsername)).toBe('dealer-user');

      // The safe view returned to the API never carries the raw value either way.
      expect(result).not.toHaveProperty('phonePeWebhookUsername');
      expect(result.phonePeWebhookUsernameSet).toBe(true);
    });

    it('rejects enabling auto-capture with no provider set', async () => {
      prisma.upiCaptureConfig.upsert.mockResolvedValue(baseRow());

      await expect(
        runInTenantContext({ pumpId: PUMP_ID }, () => service.update({ autoCaptureEnabled: true })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.upiCaptureConfig.update).not.toHaveBeenCalled();
    });

    it('rejects enabling PhonePe auto-capture without both username and password', async () => {
      prisma.upiCaptureConfig.upsert.mockResolvedValue(
        baseRow({ provider: UpiMerchantProvider.PHONEPE, phonePeWebhookUsername: encryptCredential('u') }),
      );

      await expect(
        runInTenantContext({ pumpId: PUMP_ID }, () => service.update({ autoCaptureEnabled: true })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects enabling Paytm auto-capture without a merchant key', async () => {
      prisma.upiCaptureConfig.upsert.mockResolvedValue(baseRow({ provider: UpiMerchantProvider.PAYTM }));

      await expect(
        runInTenantContext({ pumpId: PUMP_ID }, () => service.update({ autoCaptureEnabled: true })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('allows enabling auto-capture once the required credentials are already on file', async () => {
      prisma.upiCaptureConfig.upsert.mockResolvedValue(
        baseRow({ provider: UpiMerchantProvider.PAYTM, paytmMerchantKey: encryptCredential('testmerchantkey1') }),
      );
      prisma.upiCaptureConfig.update.mockImplementation(({ data }) => ({ ...baseRow(), ...data }));

      const result = await runInTenantContext({ pumpId: PUMP_ID }, () =>
        service.update({ autoCaptureEnabled: true }),
      );

      expect(result.autoCaptureEnabled).toBe(true);
    });
  });
});
