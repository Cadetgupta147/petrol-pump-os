import { Prisma } from '@prisma/client';

// Voucher.voucherNumber — human-friendly, per-pump sequential number:
// <PUMP_CODE>-V-<seq, zero-padded to 6>, e.g. "PUMP001-V-000123". Same
// pattern as Bill.billNumber (see bills/bill-number.ts), except the counter
// row is self-initializing via upsert here rather than requiring a separate
// pump-provisioning step to pre-create it — VoucherNumberCounter didn't
// exist before this feature, so there's no bootstrap path to hook into yet.

const SEQ_PAD = 6;

export function formatVoucherNumber(seq: number, pumpCode: string): string {
  if (!Number.isInteger(seq) || seq <= 0) {
    throw new Error(`Voucher sequence must be a positive integer, got ${seq}`);
  }
  return `${pumpCode}-V-${String(seq).padStart(SEQ_PAD, '0')}`;
}

// Atomically claims the next voucher number and formats it with the pump's
// code. MUST be called with the SAME transaction client that creates the
// Voucher row, so a failed create rolls the counter increment back too —
// the upsert's single UPDATE-or-INSERT is serialized by Postgres's row
// lock (same race-safety argument as allocateBillNumber()), and the
// @@unique([pumpId, voucherNumber]) on Voucher is the DB-level backstop
// regardless.
export async function allocateVoucherNumber(
  db: Pick<Prisma.TransactionClient, 'voucherNumberCounter' | 'pump'>,
  pumpId: string,
): Promise<string> {
  const [counter, pump] = await Promise.all([
    db.voucherNumberCounter.upsert({
      where: { pumpId },
      create: { pumpId, lastSeq: 1 },
      update: { lastSeq: { increment: 1 } },
    }),
    db.pump.findUniqueOrThrow({ where: { id: pumpId } }),
  ]);
  return formatVoucherNumber(counter.lastSeq, pump.pumpCode);
}
