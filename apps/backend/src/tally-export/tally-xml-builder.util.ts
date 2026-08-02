import { DrCr, LedgerGroup, VoucherType } from '@prisma/client';

// Section 12 fix (docs/ledger-accounting-review.md finding #4) — this used
// to re-derive Sales/Receipt vouchers straight from Bill/Payment rows with a
// hardcoded ledger set ('Cash', 'Bank', 'UPI', 'Sales Account'), completely
// bypassing the real LedgerAccount/Voucher/VoucherLine tables — so every
// Expense, Cash Custody entry, Shift Sales entry, manual Voucher Entry, and
// Purchase was invisible to whatever an accountant actually received. Now
// generic over the SAME LedgerAccount/Voucher/VoucherLine rows the Day Book
// reads: every active ledger becomes a Tally LEDGER master (with its real
// name/code-derived identity and opening balance — Tally masters key off
// NAME, never off our internal id/code), and every Voucher in the export
// range becomes a Tally VOUCHER, regardless of which PumpOS source posted
// it. A future source posting to the ledger is exported automatically, with
// no per-source-type code needed here.
//
// Tally sign convention followed throughout: a debit ledger entry carries
// ISDEEMEDPOSITIVE=Yes and a NEGATIVE amount; a credit ledger entry carries
// ISDEEMEDPOSITIVE=No and a POSITIVE amount. This is the standard convention
// used in Tally's own sample import XML — flagged for human review since
// there's no live Tally instance in this environment to verify the import
// actually behaves as expected. Opening balances follow the same "Dr
// positive, Cr negative" convention.

export interface LedgerAccountForExport {
  name: string;
  group: LedgerGroup;
  openingBalance: number;
  openingBalanceType: DrCr;
}

export interface VoucherLineForExport {
  ledgerAccountName: string;
  amount: number;
  drCr: DrCr;
  narration: string | null;
}

export interface VoucherForExport {
  voucherNumber: string;
  date: Date;
  voucherType: VoucherType;
  narration: string | null;
  lines: VoucherLineForExport[];
}

// Amounts within this tolerance of zero are treated as zero and skipped —
// same float-safety reasoning as BillsService's BALANCE_EPSILON.
const ZERO_EPSILON = 0.005;

const GROUP_TO_TALLY_PARENT: Record<LedgerGroup, string> = {
  CASH_IN_HAND: 'Cash-in-hand',
  BANK: 'Bank Accounts',
  SALES: 'Sales Accounts',
  PURCHASE: 'Purchase Accounts',
  SUNDRY_DEBTOR: 'Sundry Debtors',
  SUNDRY_CREDITOR: 'Sundry Creditors',
  DIRECT_EXPENSE: 'Direct Expenses',
  INDIRECT_EXPENSE: 'Indirect Expenses',
  CAPITAL_ACCOUNT: 'Capital Account',
  OTHER: 'Suspense A/c',
};

const VOUCHER_TYPE_TO_TALLY: Record<VoucherType, string> = {
  PAYMENT: 'Payment',
  RECEIPT: 'Receipt',
  CONTRA: 'Contra',
  JOURNAL: 'Journal',
  SALES: 'Sales',
  PURCHASE: 'Purchase',
};

export function buildTallyExportXml(params: {
  companyName: string;
  ledgerAccounts: LedgerAccountForExport[];
  vouchers: VoucherForExport[];
}): string {
  const { companyName, ledgerAccounts, vouchers } = params;

  const ledgerMasters = ledgerAccounts.map(ledgerMasterXml).join('\n');
  const voucherXmls = vouchers
    .map(voucherXml)
    .filter((xml) => xml.length > 0)
    .join('\n');

  return [
    '<ENVELOPE>',
    '<HEADER>',
    '<TALLYREQUEST>Import Data</TALLYREQUEST>',
    '</HEADER>',
    '<BODY>',
    '<IMPORTDATA>',
    '<REQUESTDESC>',
    '<REPORTNAME>All Masters</REPORTNAME>',
    '<STATICVARIABLES>',
    `<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>`,
    '</STATICVARIABLES>',
    '</REQUESTDESC>',
    '<REQUESTDATA>',
    ledgerMasters,
    voucherXmls,
    '</REQUESTDATA>',
    '</IMPORTDATA>',
    '</BODY>',
    '</ENVELOPE>',
  ]
    .filter((segment) => segment.length > 0)
    .join('\n');
}

function ledgerMasterXml(account: LedgerAccountForExport): string {
  const escapedName = escapeXml(account.name);
  const openingSigned =
    account.openingBalanceType === 'DEBIT' ? account.openingBalance : -account.openingBalance;
  return [
    '<TALLYMESSAGE xmlns:UDF="TallyUDF">',
    `<LEDGER NAME="${escapedName}" ACTION="Create">`,
    `<NAME>${escapedName}</NAME>`,
    `<PARENT>${escapeXml(GROUP_TO_TALLY_PARENT[account.group])}</PARENT>`,
    `<OPENINGBALANCE>${openingSigned.toFixed(2)}</OPENINGBALANCE>`,
    '</LEDGER>',
    '</TALLYMESSAGE>',
  ].join('\n');
}

function voucherXml(voucher: VoucherForExport): string {
  const entries = voucher.lines
    .filter((line) => Math.abs(line.amount) >= ZERO_EPSILON)
    .map((line) => ledgerEntryXml(line.ledgerAccountName, line.amount, line.drCr === 'DEBIT'));
  if (entries.length === 0) return '';

  const narration = voucher.narration ?? voucher.lines.find((l) => l.narration)?.narration ?? '';

  return [
    '<TALLYMESSAGE xmlns:UDF="TallyUDF">',
    `<VOUCHER VCHTYPE="${VOUCHER_TYPE_TO_TALLY[voucher.voucherType]}" ACTION="Create">`,
    `<DATE>${formatTallyDate(voucher.date)}</DATE>`,
    `<NARRATION>${escapeXml(narration)}</NARRATION>`,
    `<VOUCHERTYPENAME>${VOUCHER_TYPE_TO_TALLY[voucher.voucherType]}</VOUCHERTYPENAME>`,
    `<VOUCHERNUMBER>${escapeXml(voucher.voucherNumber)}</VOUCHERNUMBER>`,
    entries.join('\n'),
    '</VOUCHER>',
    '</TALLYMESSAGE>',
  ].join('\n');
}

function ledgerEntryXml(name: string, amount: number, isDebit: boolean): string {
  const signedAmount = isDebit ? -amount : amount;
  return [
    '<ALLLEDGERENTRIES.LIST>',
    `<LEDGERNAME>${escapeXml(name)}</LEDGERNAME>`,
    `<ISDEEMEDPOSITIVE>${isDebit ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>`,
    `<AMOUNT>${signedAmount.toFixed(2)}</AMOUNT>`,
    '</ALLLEDGERENTRIES.LIST>',
  ].join('\n');
}

// Tally's native voucher date format is YYYYMMDD (no separators). Uses the
// Date object's local calendar fields, consistent with how the rest of this
// codebase treats timestamps (no explicit timezone handling exists anywhere
// else either — see dashboard.service.ts's getStartAndEndOfToday()).
function formatTallyDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

// XML-escapes any interpolated string field (ledger names, narrations,
// etc.) — the one real injection risk in this otherwise-static template
// schema.
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
