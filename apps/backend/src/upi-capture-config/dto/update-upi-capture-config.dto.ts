import { IsBoolean, IsEnum, IsOptional, IsString, Length, MinLength } from 'class-validator';
import { UpiMerchantProvider } from '@prisma/client';

// PATCH /upi-capture-config — Section 8A.3. Any subset of these fields.
//
// Turning autoCaptureEnabled on requires the matching provider credentials
// to already be set (either in this same request or a prior one) — see
// UpiCaptureConfigService.update() for the actual check, since it depends
// on which `provider` is configured and can't be expressed with
// class-validator decorators alone.
export class UpdateUpiCaptureConfigDto {
  @IsOptional()
  @IsBoolean()
  autoCaptureEnabled?: boolean;

  @IsOptional()
  @IsEnum(UpiMerchantProvider)
  provider?: UpiMerchantProvider;

  @IsOptional()
  @IsString()
  @MinLength(1)
  phonePeWebhookUsername?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  phonePeWebhookPassword?: string;

  // Real Paytm merchant keys are always exactly 16 characters — the
  // `paytmchecksum` package AES-128-CBC-encrypts against this key directly
  // (requires a 16-byte key, throws RangeError otherwise) — confirmed
  // empirically against node_modules/paytmchecksum/PaytmChecksum.js. See
  // verify-webhook-signature.util.spec.ts.
  @IsOptional()
  @IsString()
  @Length(16, 16)
  paytmMerchantKey?: string;
}
