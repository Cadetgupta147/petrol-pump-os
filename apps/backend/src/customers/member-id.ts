import { Prisma } from '@prisma/client';

// ---------------------------------------------------------------------------
// Section 6.1/6.7 — human-friendly member IDs.
//
// Format:  <PUMP_CODE>-CUST-<seq>-<check>   e.g.  PUMP001-CUST-04521-6
//   - PUMP_CODE: Pump.pumpCode for the pump this customer belongs to (Phase
//     0.2, docs/multi-tenancy-plan.md — previously a single global PUMP_CODE
//     env var; now read from the DB so each pump gets its own prefix).
//   - seq: monotonic customer sequence from that pump's MemberIdCounter row,
//     zero-padded to 5 digits (grows naturally past 99999).
//   - check: Luhn check digit over the padded sequence digits — Section 6.1's
//     "optional checksum for manual fallback entry", so a DSM typing the ID
//     by hand when a card won't scan gets typos caught client- or
//     server-side via isValidQrMemberId().
//
// This ID is the ONLY thing the customer's QR encodes (Section 6.1: pointer,
// not wallet) — the format change just makes it readable/typeable; it still
// carries no name, phone, points, or rate.
//
// The SQL backfill in prisma/migrations/20260719075350_human_friendly_member_ids
// implements the same Luhn — luhnCheckDigit() below and that migration must
// agree (pinned by member-id.spec.ts using values the migration produced).
// ---------------------------------------------------------------------------

const SEQ_PAD = 5;

// Standard Luhn: from the rightmost payload digit (which sits immediately
// left of where the check digit will go), double every other digit,
// subtracting 9 when a doubled digit exceeds 9; check = (10 − sum mod 10)
// mod 10.
export function luhnCheckDigit(digits: string): number {
  if (!/^\d+$/.test(digits)) {
    throw new Error(`luhnCheckDigit expects digits only, got "${digits}"`);
  }
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    const positionFromRight = digits.length - i;
    let d = Number(digits[i]);
    if (positionFromRight % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return (10 - (sum % 10)) % 10;
}

export function formatQrMemberId(seq: number, pumpCode: string): string {
  if (!Number.isInteger(seq) || seq <= 0) {
    throw new Error(`Member sequence must be a positive integer, got ${seq}`);
  }
  const padded = String(seq).padStart(SEQ_PAD, '0');
  return `${pumpCode}-CUST-${padded}-${luhnCheckDigit(padded)}`;
}

// Checksum validation for manual fallback entry (Section 6.1). Deliberately
// does NOT pin the pump-code segment to the current PUMP_CODE env value:
// cards printed before a pump-code change must keep validating.
export function isValidQrMemberId(id: string): boolean {
  const match = /^[A-Z0-9]+-CUST-(\d{5,})-(\d)$/.exec(id);
  if (!match) return false;
  return Number(match[2]) === luhnCheckDigit(match[1]);
}

// Atomically claims the next member number (from the given pump's counter
// row) and formats it with that pump's code. MUST be called with the SAME
// transaction client that creates the Customer row, so a failed create rolls
// the counter increment back too. The increment-and-return is a single
// UPDATE, so concurrent transactions can never mint the same number for a
// given pump (the @unique on Customer.qrMemberId is the DB-level backstop).
//
// Phase 0.2 (docs/multi-tenancy-plan.md): every pump needs its own
// MemberIdCounter row — the migration backfill created one for the seeded
// default pump (pumpId set on the pre-existing singleton row); a real pump
// provisioning flow (Phase 5) must create one for every new pump too, or
// this throws (findUniqueOrThrow-style failure via update-on-missing-row).
export async function allocateQrMemberId(
  db: Pick<Prisma.TransactionClient, 'memberIdCounter' | 'pump'>,
  pumpId: string,
): Promise<string> {
  const [counter, pump] = await Promise.all([
    db.memberIdCounter.update({
      where: { pumpId },
      data: { lastSeq: { increment: 1 } },
    }),
    db.pump.findUniqueOrThrow({ where: { id: pumpId } }),
  ]);
  return formatQrMemberId(counter.lastSeq, pump.pumpCode);
}
