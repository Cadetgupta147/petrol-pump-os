import { Prisma } from '@prisma/client';

// Bill.billNumber — human-friendly, per-pump sequential bill number:
// <PUMP_CODE>-<seq, zero-padded to 6>, e.g. "PUMP001-000123". Same
// "per-pump counter row, atomically incremented in the same transaction as
// the row it numbers" pattern as Customer.qrMemberId — see
// apps/backend/src/customers/member-id.ts (allocateQrMemberId()) for the
// original. No Luhn check digit here (unlike qrMemberId): a bill number is
// only ever looked up in a search box, never hand-typed as an identity
// token that has to survive a mis-scan, so there's nothing to checksum
// against.

const SEQ_PAD = 6;

export function formatBillNumber(seq: number, pumpCode: string): string {
  if (!Number.isInteger(seq) || seq <= 0) {
    throw new Error(`Bill sequence must be a positive integer, got ${seq}`);
  }
  return `${pumpCode}-${String(seq).padStart(SEQ_PAD, '0')}`;
}

// Atomically claims the next bill number (from the given pump's counter row)
// and formats it with that pump's code. MUST be called with the SAME
// transaction client that creates the Bill row, so a failed create rolls the
// counter increment back too — see allocateQrMemberId()'s comment for why
// this is race-safe (the increment is a single UPDATE, serialized by
// Postgres's row lock) and the @unique on Bill.billNumber is the DB-level
// backstop regardless.
export async function allocateBillNumber(
  db: Pick<Prisma.TransactionClient, 'billNumberCounter' | 'pump'>,
  pumpId: string,
): Promise<string> {
  const [counter, pump] = await Promise.all([
    db.billNumberCounter.update({
      where: { pumpId },
      data: { lastSeq: { increment: 1 } },
    }),
    db.pump.findUniqueOrThrow({ where: { id: pumpId } }),
  ]);
  return formatBillNumber(counter.lastSeq, pump.pumpCode);
}
