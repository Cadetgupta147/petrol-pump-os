// Delivery abstraction for OTP codes — Section 5 (Credit Customer App login)
// and Section 17's open item "SMS/WhatsApp gateway provider not yet chosen".
//
// CustomerAuthService depends on this interface only, never on a concrete
// provider, so wiring in a real SMS/WhatsApp OTP gateway later is a
// module-wiring change (swap the OTP_PROVIDER binding in
// customer-auth.module.ts), not a CustomerAuthService change.
//
// Do NOT implement a real gateway against this interface without an
// explicit provider decision from the user — see CLAUDE.md open items and
// .env.example's SMS_GATEWAY_*/WHATSAPP_* placeholders. The only
// implementation in this codebase right now is ConsoleOtpProvider (dev-mode
// stub — logs to the server console, never sends anything over SMS/WhatsApp).
export const OTP_PROVIDER = Symbol('OTP_PROVIDER');

export interface OtpProvider {
  /** Deliver a plaintext OTP `code` to `phone`. Never called with a hash. */
  sendOtp(phone: string, code: string): Promise<void>;
}
