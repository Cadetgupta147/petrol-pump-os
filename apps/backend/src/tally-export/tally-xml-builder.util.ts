import { PaymentDirection, PaymentType } from '@prisma/client';
import { aggregateByPaymentType } from '../dashboard/payment-line-aggregation.util';

// Section 10 — Tally XML export (ENVELOPE > HEADER > BODY > IMPORTDATA >
// REQUESTDATA > TALLYMESSAGE, containing <LEDGER> masters and <VOUCHER>
// entries). Pure string-building, no Prisma/Nest imports — mirrors how
// payment-line-aggregation.util.ts is kept pure and unit-tested in
// isolation from dashboard.service.ts (see that file's header comment).
//
// Tally sign convention followed throughout: a debit ledger entry carries
// ISDEEMEDPOSITIVE=Yes and a NEGATIVE amount; a credit ledger entry carries
// ISDEEMEDPOSITIVE=No and a POSITIVE amount. This is the standard convention
// used in Tally's own sample import XML — flagged for human review since
// there's no live Tally instance in this environment to verify the import
// actually behaves as expected.

export type BillPaymentLineForExport = {
  paymentType: PaymentType;
  amount: number;
  direction: PaymentDirection;
};

export type BillForExport = {
  id: string;
  timestamp: Date;
  amount: number;
  customerName: string | null;
  vehicleNumber: string | null;
  // The linked Customer, if any. Section 5A / BillsService.create() already
  // guarantees any bill with a CREDIT payment line has a customer attached
  // (existing or quick-added) — so whenever a bill's CREDIT net is nonzero,
  // this should be non-null in practice.
  customer: { id: string; name: string } | null;
  paymentLines: BillPaymentLineForExport[];
};

export type PaymentForExport = {
  id: string;
  createdAt: Date;
  amount: number;
  method: PaymentType;
  customer: { id: string; name: string };
};

const STATIC_LEDGERS: Array<{ name: string; parent: string }> = [
  { name: 'Cash', parent: 'Cash-in-hand' },
  { name: 'Bank', parent: 'Bank Accounts' },
  { name: 'UPI', parent: 'Bank Accounts' },
  { name: 'Sales Account', parent: 'Sales Accounts' },
];

const SALES_ACCOUNT_LEDGER = 'Sales Account';

// Amounts within this tolerance of zero are treated as zero and skipped —
// same float-safety reasoning as BillsService's BALANCE_EPSILON.
const ZERO_EPSILON = 0.005;

export function buildTallyExportXml(params: {
  companyName: string;
  bills: BillForExport[];
  payments: PaymentForExport[];
}): string {
  const { companyName, bills, payments } = params;

  const customers = collectUniqueCustomers(bills, payments);
  const ledgerMasters = buildLedgerMastersXml(customers);
  const salesVouchers = bills.map(buildSalesVoucherXml).join('\n');
  const receiptVouchers = payments.map(buildReceiptVoucherXml).join('\n');

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
    salesVouchers,
    receiptVouchers,
    '</REQUESTDATA>',
    '</IMPORTDATA>',
    '</BODY>',
    '</ENVELOPE>',
  ]
    .filter((segment) => segment.length > 0)
    .join('\n');
}

function collectUniqueCustomers(
  bills: BillForExport[],
  payments: PaymentForExport[],
): Array<{ id: string; name: string }> {
  const map = new Map<string, string>();
  for (const bill of bills) {
    if (bill.customer) {
      map.set(bill.customer.id, bill.customer.name);
    }
  }
  for (const payment of payments) {
    map.set(payment.customer.id, payment.customer.name);
  }
  return Array.from(map, ([id, name]) => ({ id, name }));
}

function buildLedgerMastersXml(
  customers: Array<{ id: string; name: string }>,
): string {
  const staticLedgerXml = STATIC_LEDGERS.map((ledger) =>
    ledgerMasterXml(ledger.name, ledger.parent),
  );
  const customerLedgerXml = customers.map((customer) =>
    ledgerMasterXml(customer.name, 'Sundry Debtors'),
  );
  return [...staticLedgerXml, ...customerLedgerXml].join('\n');
}

function ledgerMasterXml(name: string, parent: string): string {
  const escapedName = escapeXml(name);
  return [
    '<TALLYMESSAGE xmlns:UDF="TallyUDF">',
    `<LEDGER NAME="${escapedName}" ACTION="Create">`,
    `<NAME>${escapedName}</NAME>`,
    `<PARENT>${escapeXml(parent)}</PARENT>`,
    '</LEDGER>',
    '</TALLYMESSAGE>',
  ].join('\n');
}

// Section 5A netting reused for the Tally mapping: for each nonzero
// per-paymentType net (IN - OUT), CASH/CARD/UPI map to their static ledger
// and CREDIT maps to the specific customer's ledger. A positive net is a
// debit entry (money/receivable increased); a negative net (e.g. a bill
// where UPI was overpaid and CASH change was given back, so CASH nets
// negative) is a credit entry instead. Sales Account is always credited for
// the bill's full amount. Because sum(all nets) = bill.amount (Section
// 5A.1, enforced server-side in BillsService), debits always equal credits
// here regardless of how many lines net negative.
function buildSalesVoucherXml(bill: BillForExport): string {
  const nets = aggregateByPaymentType(bill.paymentLines);
  const entries: string[] = [];

  (Object.keys(nets) as PaymentType[]).forEach((paymentType) => {
    const net = nets[paymentType];
    if (Math.abs(net) < ZERO_EPSILON) {
      return;
    }
    const ledgerName = ledgerNameForBillPaymentType(paymentType, bill.customer);
    entries.push(ledgerEntryXml(ledgerName, Math.abs(net), net > 0));
  });

  entries.push(ledgerEntryXml(SALES_ACCOUNT_LEDGER, bill.amount, false));

  const narrationParts = [`Bill ${bill.id}`];
  if (bill.customerName) narrationParts.push(bill.customerName);
  if (bill.vehicleNumber) narrationParts.push(bill.vehicleNumber);

  return [
    '<TALLYMESSAGE xmlns:UDF="TallyUDF">',
    '<VOUCHER VCHTYPE="Sales" ACTION="Create">',
    `<DATE>${formatTallyDate(bill.timestamp)}</DATE>`,
    `<NARRATION>${escapeXml(narrationParts.join(' - '))}</NARRATION>`,
    '<VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>',
    `<VOUCHERNUMBER>${escapeXml(bill.id)}</VOUCHERNUMBER>`,
    entries.join('\n'),
    '</VOUCHER>',
    '</TALLYMESSAGE>',
  ].join('\n');
}

// Section 10.2 — Payment -> Receipt Voucher: debit the payment's method
// ledger for `amount`, credit the customer's ledger for `amount` (money
// coming in against the customer's outstanding credit balance).
function buildReceiptVoucherXml(payment: PaymentForExport): string {
  const methodLedgerName = ledgerNameForPaymentMethod(
    payment.method,
    payment.customer.name,
  );

  const entries = [
    ledgerEntryXml(methodLedgerName, payment.amount, true),
    ledgerEntryXml(payment.customer.name, payment.amount, false),
  ];

  return [
    '<TALLYMESSAGE xmlns:UDF="TallyUDF">',
    '<VOUCHER VCHTYPE="Receipt" ACTION="Create">',
    `<DATE>${formatTallyDate(payment.createdAt)}</DATE>`,
    `<NARRATION>${escapeXml(`Payment received from ${payment.customer.name}`)}</NARRATION>`,
    '<VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME>',
    `<VOUCHERNUMBER>${escapeXml(payment.id)}</VOUCHERNUMBER>`,
    entries.join('\n'),
    '</VOUCHER>',
    '</TALLYMESSAGE>',
  ].join('\n');
}

function ledgerNameForBillPaymentType(
  paymentType: PaymentType,
  customer: { id: string; name: string } | null,
): string {
  if (paymentType === 'CREDIT') {
    // Defensive fallback: BillsService requires a customer whenever a CREDIT
    // line exists, so `customer` should never actually be null here.
    return customer ? customer.name : 'Sundry Debtors';
  }
  return staticLedgerNameForPaymentType(paymentType);
}

function ledgerNameForPaymentMethod(
  method: PaymentType,
  customerLedgerName: string,
): string {
  if (method === 'CREDIT') {
    // Payment.method is not expected to be CREDIT in practice (a repayment
    // against credit wouldn't itself be paid "by credit") — fall back to the
    // customer's own ledger defensively rather than throwing.
    return customerLedgerName;
  }
  return staticLedgerNameForPaymentType(method);
}

function staticLedgerNameForPaymentType(
  paymentType: Exclude<PaymentType, 'CREDIT'>,
): string {
  switch (paymentType) {
    case 'CASH':
      return 'Cash';
    case 'CARD':
      return 'Bank';
    case 'UPI':
      return 'UPI';
  }
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

// XML-escapes any interpolated string field (customer names, vehicle
// numbers, narrations, etc.) — the one real injection risk in this
// otherwise-static template schema.
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
