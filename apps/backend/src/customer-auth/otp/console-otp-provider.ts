import { Injectable, Logger } from '@nestjs/common';
import { OtpProvider } from './otp-provider.interface';

// Keeps only the last 3 digits (e.g. "9990000001" -> "*******001") — enough
// to correlate a log line with a support ticket without the full number
// being recoverable from server logs.
function maskPhone(phone: string): string {
  if (phone.length <= 3) return '*'.repeat(phone.length);
  return '*'.repeat(phone.length - 3) + phone.slice(-3);
}

// Dev-mode stub — the ONLY OtpProvider implementation in this codebase, and
// (until a real SMS/WhatsApp gateway is chosen and wired in — a cost/vendor
// decision reserved for the user per CLAUDE.md, not something an agent
// should pick) the provider that would ALSO be bound in a real deployment.
// That means the same NODE_ENV=development guard used for the API response
// body (see CustomerAuthService.requestOtp) applies here too: logging the
// plaintext OTP unconditionally would leak every customer's login code into
// production server logs the moment this stub is ever running outside dev,
// which is a real risk given no real provider is wired in yet.
@Injectable()
export class ConsoleOtpProvider implements OtpProvider {
  private readonly logger = new Logger(ConsoleOtpProvider.name);

  async sendOtp(phone: string, code: string): Promise<void> {
    if (process.env.NODE_ENV === 'development') {
      this.logger.log(`[DEV-ONLY OTP STUB] Would send OTP ${code} to ${phone}`);
    } else {
      // Same delivery-attempt visibility, without the plaintext code OR the
      // full phone number, in any non-development environment — server logs
      // are not an approved place for customer PII (see CLAUDE.md's DPDP note).
      this.logger.log(
        `[DEV-ONLY OTP STUB] Would send OTP to ${maskPhone(phone)} (code withheld — NODE_ENV is not "development")`,
      );
    }
    return Promise.resolve();
  }
}
