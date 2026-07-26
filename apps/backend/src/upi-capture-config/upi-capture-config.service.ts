import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, UpiCaptureConfig, UpiMerchantProvider } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { requireTenantContext } from '../common/tenant-context';
import { decryptCredential, encryptCredential } from '../common/credential-encryption.util';
import { UpdateUpiCaptureConfigDto } from './dto/update-upi-capture-config.dto';

// See credit-config.service.ts's EMPTY_UNIQUE_WHERE comment for why this
// cast is needed and safe — same singleton-per-pump pattern, same reason.
const EMPTY_UNIQUE_WHERE = {} as Prisma.UpiCaptureConfigWhereUniqueInput;

// Section 8A.3 — dealer-configurable UPI auto-capture: whether this pump's
// walkInUpiCollected is filled by the PhonePe/Paytm webhook or entered
// manually by the DSM (see ShiftSalesService). Singleton-per-pump, same
// upsert-on-read pattern as CreditConfigService — see that file's comment
// for the multi-tenancy history.
//
// Never returns raw secrets over the API — toSafeView() strips them down to
// booleans (see the controller/DTO). getRaw()/findByPumpId() are for
// internal callers only (ShiftSalesService, UpiWebhookService) that
// actually need to verify a signature or decide whether to accept a
// manually-entered walkInUpiCollected.
export type SafeUpiCaptureConfig = Omit<
  UpiCaptureConfig,
  'phonePeWebhookUsername' | 'phonePeWebhookPassword' | 'paytmMerchantKey'
> & {
  phonePeWebhookUsernameSet: boolean;
  phonePeWebhookPasswordSet: boolean;
  paytmMerchantKeySet: boolean;
};

@Injectable()
export class UpiCaptureConfigService {
  constructor(private readonly prisma: PrismaService) {}

  // Decrypts the three credential columns on a row straight out of the DB —
  // see credential-encryption.util.ts. Every read path (getRaw(),
  // findByPumpId()) routes through this so no caller ever has to think
  // about encryption; they just get plaintext (or null) back, exactly as
  // before this hardening pass.
  private decryptRow(row: UpiCaptureConfig): UpiCaptureConfig {
    return {
      ...row,
      phonePeWebhookUsername: decryptCredential(row.phonePeWebhookUsername),
      phonePeWebhookPassword: decryptCredential(row.phonePeWebhookPassword),
      paytmMerchantKey: decryptCredential(row.paytmMerchantKey),
    };
  }

  toSafeView(config: UpiCaptureConfig): SafeUpiCaptureConfig {
    const {
      phonePeWebhookUsername,
      phonePeWebhookPassword,
      paytmMerchantKey,
      ...rest
    } = config;
    return {
      ...rest,
      phonePeWebhookUsernameSet: !!phonePeWebhookUsername,
      phonePeWebhookPasswordSet: !!phonePeWebhookPassword,
      paytmMerchantKeySet: !!paytmMerchantKey,
    };
  }

  // Raw (unredacted) row for the current request's tenant — used by
  // ShiftSalesService to decide whether a manually-entered walkInUpiCollected
  // is allowed. Auto-creates a disabled-by-default row on first read, same
  // as CreditConfigService.getOrCreate() — "no row yet" and "explicitly
  // disabled" are the same thing to every caller.
  async getRaw(): Promise<UpiCaptureConfig> {
    const row = await this.prisma.upiCaptureConfig.upsert({
      where: EMPTY_UNIQUE_WHERE,
      create: { pumpId: requireTenantContext().pumpId },
      update: {},
    });
    return this.decryptRow(row);
  }

  async getOrCreate(): Promise<SafeUpiCaptureConfig> {
    return this.toSafeView(await this.getRaw());
  }

  // Section 8A.3 — called by UpiWebhookController BEFORE any tenant context
  // is established (this route has no JWT — see that controller's comment).
  // Deliberately a plain findUnique, not upsert: an unauthenticated webhook
  // request hitting an unconfigured/wrong pumpId must never have the
  // side-effect of creating a row. Returns null if this pump has never
  // configured UPI capture at all.
  async findByPumpId(pumpId: string): Promise<UpiCaptureConfig | null> {
    const row = await this.prisma.upiCaptureConfig.findUnique({ where: { pumpId } });
    return row ? this.decryptRow(row) : null;
  }

  async update(dto: UpdateUpiCaptureConfigDto): Promise<SafeUpiCaptureConfig> {
    const existing = await this.getRaw();

    const merged = {
      autoCaptureEnabled: dto.autoCaptureEnabled ?? existing.autoCaptureEnabled,
      provider: dto.provider ?? existing.provider,
      phonePeWebhookUsername:
        dto.phonePeWebhookUsername ?? existing.phonePeWebhookUsername,
      phonePeWebhookPassword:
        dto.phonePeWebhookPassword ?? existing.phonePeWebhookPassword,
      paytmMerchantKey: dto.paytmMerchantKey ?? existing.paytmMerchantKey,
    };

    // Guard: don't let a dealer flip auto-capture on without the
    // credentials needed to actually verify that provider's webhook —
    // that would silently start trusting an UNSIGNED/unverifiable payload
    // shape the moment a provider is later wired up, or just leave
    // autoCaptureEnabled=true with no way for UpiWebhookService to ever
    // validate a delivery (every one would be rejected, and UPI would
    // silently stop being captured at all — worse than staying manual).
    if (merged.autoCaptureEnabled) {
      if (!merged.provider) {
        throw new BadRequestException(
          'Set a provider (PHONEPE or PAYTM) before enabling auto-capture.',
        );
      }
      if (
        merged.provider === UpiMerchantProvider.PHONEPE &&
        (!merged.phonePeWebhookUsername || !merged.phonePeWebhookPassword)
      ) {
        throw new BadRequestException(
          'phonePeWebhookUsername and phonePeWebhookPassword are both required before enabling auto-capture for PhonePe.',
        );
      }
      if (
        merged.provider === UpiMerchantProvider.PAYTM &&
        !merged.paytmMerchantKey
      ) {
        throw new BadRequestException(
          'paytmMerchantKey is required before enabling auto-capture for Paytm.',
        );
      }
    }

    // Encrypt right before the write — everything above (the guard, the
    // merge with `existing`) deliberately worked on plaintext so it reads
    // naturally; this is the one place plaintext turns into ciphertext
    // before touching the DB. See credential-encryption.util.ts.
    const updated = await this.prisma.upiCaptureConfig.update({
      where: EMPTY_UNIQUE_WHERE,
      data: {
        ...merged,
        phonePeWebhookUsername: encryptCredential(merged.phonePeWebhookUsername),
        phonePeWebhookPassword: encryptCredential(merged.phonePeWebhookPassword),
        paytmMerchantKey: encryptCredential(merged.paytmMerchantKey),
      },
    });
    return this.toSafeView(this.decryptRow(updated));
  }
}
