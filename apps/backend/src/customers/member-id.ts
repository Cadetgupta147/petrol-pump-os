import { Prisma } from '@prisma/client';

// ---------------------------------------------------------------------------
// Section 6.1/6.7 — human-friendly member IDs.
//
// Format:  <PUMP_CODE>-CUST-<seq>-<check>   e.g.  PUMP001-CUST-04521-6
//   - PUMP_CODE: from the PUMP_CODE env var, default "PUMP001" (single-pump
//     deployment; becomes per-pump config if multi-pump ever exists).
//   - seq: monotonic customer sequence from the MemberIdCounter singleton,
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

const DEFAULT_PUMP_CODE = 'PUMP001';
const MEMBER_ID_COUNTER_ID = 'singleton';
const SEQ_PAD = 5;

export function pumpCode(): string {
  const configured = process.env.PUMP_CODE?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_PUMP_CODE;
}

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

export function formatQrMemberId(seq: number): string {
  if (!Number.isInteger(seq) || seq <= 0) {
    throw new Error(`Member sequence must be a positive integer, got ${seq}`);
  }
  const padded = String(seq).padStart(SEQ_PAD, '0');
  return `${pumpCode()}-CUST-${padded}-${luhnCheckDigit(padded)}`;
}

// Checksum validation for manual fallback entry (Section 6.1). Deliberately
// does NOT pin the pump-code segment to the current PUMP_CODE env value:
// cards printed before a pump-code change must keep validating.
export function isValidQrMemberId(id: string): boolean {
  const match = /^[A-Z0-9]+-CUST-(\d{5,})-(\d)$/.exec(id);
  if (!match) return false;
  return Number(match[2]) === luhnCheckDigit(match[1]);
}

// Atomically claims the next member number and formats it. MUST be called
// with the SAME transaction client that creates the Customer row, so a
// failed create rolls the counter back too. The increment-and-return is a
// single UPDATE, so concurrent transactions can never mint the same number
// (the @unique on Customer.qrMemberId is the DB-level backstop).
export async function allocateQrMemberId(
  db: Pick<Prisma.TransactionClient, 'memberIdCounter'>,
): Promise<string> {
  const counter = await db.memberIdCounter.update({
    where: { id: MEMBER_ID_COUNTER_ID },
    data: { lastSeq: { increment: 1 } },
  });
  return formatQrMemberId(counter.lastSeq);
}
