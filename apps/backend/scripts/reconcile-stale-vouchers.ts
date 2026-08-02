import { resolve } from 'path';
import * as dotenv from 'dotenv';

// Same root-.env resolution as app.module.ts's ROOT_ENV_PATH — this script
// lives at apps/backend/scripts, exactly as deep under the repo root as
// apps/backend/dist, so the same "../../../.env" reaches the same file.
dotenv.config({ path: resolve(__dirname, '../../../.env') });

/* eslint-disable @typescript-eslint/no-var-requires */
// Required after dotenv.config() runs (PrismaClient reads DATABASE_URL from
// process.env at construction time) — a top-level `import` would be hoisted
// above the dotenv.config() call above, so this must be a runtime require.
const { PrismaService } = require('../src/prisma/prisma.service') as typeof import('../src/prisma/prisma.service');
const { LedgerPostingService } = require('../src/ledger/ledger-posting.service') as typeof import('../src/ledger/ledger-posting.service');
/* eslint-enable @typescript-eslint/no-var-requires */

// Section 12 fix — one-time reconciliation for real data that predates this
// session's fixes: (1) bills/expenses whose posted voucher had already gone
// stale before postBillVoucher()/ExpensesService.remove() started
// repost/void-ing correctly, and (2) customers whose CustomerOpeningBalance
// rows predate getOrCreateCustomerLedger() summing them into a new ledger's
// seed value.
//
// DRY-RUN BY DEFAULT — prints every change it WOULD make and touches
// nothing. Pass --apply to actually write. Run with:
//   npx ts-node apps/backend/scripts/reconcile-stale-vouchers.ts
//   npx ts-node apps/backend/scripts/reconcile-stale-vouchers.ts --apply
const APPLY = process.argv.includes('--apply');
const EPSILON = 0.01;

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();
  const ledgerPosting = new LedgerPostingService(prisma);

  console.log(APPLY ? '=== APPLYING changes ===' : '=== DRY RUN (pass --apply to write) ===');

  // ---------- 1. Void vouchers for already-soft-deleted bills ----------
  const deletedBills = await prisma.bill.findMany({
    where: { deletedAt: { not: null } },
    select: { id: true, pumpId: true, billNumber: true },
  });
  let voidedBillVouchers = 0;
  for (const bill of deletedBills) {
    const sourceKey = `bill:${bill.id}`;
    const existing = await prisma.voucher.findFirst({
      where: { pumpId: bill.pumpId, sourceKey },
      select: { id: true, voucherNumber: true },
    });
    if (!existing) continue;
    console.log(
      `[void] Bill ${bill.billNumber} (${bill.id}) is deleted but voucher ${existing.voucherNumber} still exists — would void.`,
    );
    voidedBillVouchers++;
    if (APPLY) {
      await ledgerPosting.voidVoucherBySourceKey(bill.pumpId, sourceKey);
    }
  }

  // ---------- 2. Repost vouchers for bills edited before the repost fix existed ----------
  const editedBills = await prisma.bill.findMany({
    where: { deletedAt: null, lastEditedAt: { not: null } },
    include: { paymentLines: true, customer: true },
  });
  let repostedBills = 0;
  for (const bill of editedBills) {
    console.log(
      `[repost] Bill ${bill.billNumber} (${bill.id}) was edited at ${bill.lastEditedAt?.toISOString()} — would repost to match current amount/payment split.`,
    );
    repostedBills++;
    if (APPLY) {
      await ledgerPosting.postBillVoucher(bill, bill.customer?.name ?? bill.customerName ?? null);
    }
  }

  // ---------- 3. Void vouchers whose Expense was hard-deleted ----------
  const expenseVouchers = await prisma.voucher.findMany({
    where: { source: 'EXPENSE' },
    select: { id: true, pumpId: true, sourceKey: true, voucherNumber: true },
  });
  let voidedExpenseVouchers = 0;
  for (const voucher of expenseVouchers) {
    const expenseId = voucher.sourceKey?.split(':')[1];
    if (!expenseId) continue;
    const stillExists = await prisma.expenseEntry.findUnique({ where: { id: expenseId } });
    if (stillExists) continue;
    console.log(
      `[void] Expense ${expenseId} no longer exists but voucher ${voucher.voucherNumber} still does — would void.`,
    );
    voidedExpenseVouchers++;
    if (APPLY) {
      await ledgerPosting.voidVoucherBySourceKey(voucher.pumpId, voucher.sourceKey!);
    }
  }

  // ---------- 4. Reconcile customer opening balances ----------
  const customersWithOpeningBalances = await prisma.customerOpeningBalance.groupBy({
    by: ['customerId', 'pumpId'],
  });
  let seededLedgers = 0;
  let correctingVouchers = 0;
  for (const { customerId, pumpId } of customersWithOpeningBalances) {
    const [customer, rows, ledger] = await Promise.all([
      prisma.customer.findUnique({ where: { id: customerId } }),
      prisma.customerOpeningBalance.findMany({ where: { customerId } }),
      prisma.ledgerAccount.findUnique({ where: { linkedCustomerId: customerId } }),
    ]);
    if (!customer) continue;
    const expectedSigned = rows.reduce((sum, row) => sum + row.amount, 0);

    if (!ledger) {
      // No ledger yet — will be created lazily on this customer's first
      // bill/payment, and will correctly sum every row above at that point.
      // Nothing to reconcile now.
      continue;
    }

    const lineCount = await prisma.voucherLine.count({ where: { ledgerAccountId: ledger.id } });
    const openingSigned = ledger.openingBalanceType === 'DEBIT' ? ledger.openingBalance : -ledger.openingBalance;

    if (lineCount === 0) {
      // Ledger exists but has never actually been posted to (an edge case —
      // e.g. created via Voucher Entry's Ledger Master screen, or a lazily
      // created ledger with all its vouchers since voided) — safe to
      // directly seed openingBalance the same way getOrCreateCustomerLedger
      // would have, since nothing derives from the current value yet.
      const diff = expectedSigned - openingSigned;
      if (Math.abs(diff) <= EPSILON) continue;
      console.log(
        `[seed] ${customer.name} (${customerId}): ledger has no transaction history yet — would set openingBalance to ${Math.abs(expectedSigned).toFixed(2)} ${expectedSigned >= 0 ? 'DEBIT' : 'CREDIT'} (was ${Math.abs(openingSigned).toFixed(2)} ${openingSigned >= 0 ? 'DEBIT' : 'CREDIT'}).`,
      );
      seededLedgers++;
      if (APPLY) {
        await prisma.ledgerAccount.update({
          where: { id: ledger.id },
          data: {
            openingBalance: Math.abs(expectedSigned),
            openingBalanceType: expectedSigned >= 0 ? 'DEBIT' : 'CREDIT',
          },
        });
      }
      continue;
    }

    // Ledger already has real history — find what's already been accounted
    // for via correcting "opening-balance:*" vouchers (Group D's go-forward
    // path may have already posted some of these), so this reconciliation
    // only closes the remaining gap instead of double-counting.
    const adjustmentVouchers = await prisma.voucher.findMany({
      where: { pumpId, sourceKey: { startsWith: 'opening-balance:' } },
      include: { lines: { where: { ledgerAccountId: ledger.id } } },
    });
    const alreadyAccountedSigned = adjustmentVouchers.reduce((sum, v) => {
      const line = v.lines[0];
      if (!line) return sum;
      return sum + (line.drCr === 'DEBIT' ? line.amount : -line.amount);
    }, openingSigned);

    const diff = expectedSigned - alreadyAccountedSigned;
    if (Math.abs(diff) <= EPSILON) continue;

    console.log(
      `[correct] ${customer.name} (${customerId}): ledger already has history — would post a correcting voucher for ${diff.toFixed(2)} (${diff >= 0 ? 'customer owes more' : 'customer owes less'}).`,
    );
    correctingVouchers++;
    if (APPLY) {
      await ledgerPosting.postOpeningBalanceAdjustment({
        pumpId,
        customerId,
        customerName: customer.name,
        openingBalanceId: `reconcile-${customerId}`,
        amount: diff,
        effectiveAt: new Date(),
        recordedById: rows[rows.length - 1].recordedById,
      });
    }
  }

  console.log('');
  console.log('=== Summary ===');
  console.log(`Bill vouchers voided (soft-deleted bills): ${voidedBillVouchers}`);
  console.log(`Bill vouchers reposted (edited bills): ${repostedBills}`);
  console.log(`Expense vouchers voided (hard-deleted expenses): ${voidedExpenseVouchers}`);
  console.log(`Customer ledgers seeded (no prior history): ${seededLedgers}`);
  console.log(`Customer correcting vouchers posted (had history): ${correctingVouchers}`);
  if (!APPLY) {
    console.log('');
    console.log('This was a dry run — nothing was changed. Re-run with --apply to write these changes.');
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
