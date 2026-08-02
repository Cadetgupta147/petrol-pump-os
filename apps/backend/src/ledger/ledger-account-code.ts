import { Prisma } from '@prisma/client';

// LedgerAccount.code — short per-pump reference number (e.g. "0001"),
// Tally/legacy-pump-software style. Same self-initializing-upsert counter
// pattern as Voucher.voucherNumber (see voucher-number.ts), except there's
// no pump-code prefix — this is an in-app quick-reference, not a
// print-on-documents identifier.

const SEQ_PAD = 4;

export function formatLedgerAccountCode(seq: number): string {
  if (!Number.isInteger(seq) || seq <= 0) {
    throw new Error(`Ledger account code sequence must be a positive integer, got ${seq}`);
  }
  return String(seq).padStart(SEQ_PAD, '0');
}

// Atomically claims the next code. MUST be called with the SAME
// transaction/client that creates the LedgerAccount row it's for, so a
// failed create rolls the counter increment back too — same race-safety
// argument as allocateVoucherNumber().
export async function allocateLedgerAccountCode(
  db: Pick<Prisma.TransactionClient, 'ledgerAccountCodeCounter'>,
  pumpId: string,
): Promise<string> {
  const counter = await db.ledgerAccountCodeCounter.upsert({
    where: { pumpId },
    create: { pumpId, lastSeq: 1 },
    update: { lastSeq: { increment: 1 } },
  });
  return formatLedgerAccountCode(counter.lastSeq);
}
