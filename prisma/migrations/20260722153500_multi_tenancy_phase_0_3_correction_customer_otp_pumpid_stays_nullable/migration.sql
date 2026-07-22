-- Correction to the immediately-preceding Phase 0.3 migration
-- (docs/multi-tenancy-plan.md): CustomerOtp.pumpId must NOT be required,
-- unlike every other tenant table. requestOtp() is a @Public() route with
-- no JWT, and Section 5's login flow allows sending an OTP to a phone with
-- no Customer row yet (verifyOtp() cleanly 404s "not registered" rather
-- than rejecting the OTP send itself) — there is genuinely no pump to
-- attribute that OTP row to in that case. See the CustomerOtp model
-- comment in schema.prisma for the full reasoning.
ALTER TABLE "CustomerOtp" ALTER COLUMN "pumpId" DROP NOT NULL;
