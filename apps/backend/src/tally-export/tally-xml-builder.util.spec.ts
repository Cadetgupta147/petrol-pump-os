import {
  LedgerAccountForExport,
  VoucherForExport,
  buildTallyExportXml,
  escapeXml,
} from './tally-xml-builder.util';

// Rule-heavy logic per CLAUDE.md testing guidance — this is Section 5A's
// "debits must equal credits" invariant applied to Tally vouchers, plus the
// one real injection risk in an otherwise-static XML schema (unescaped
// interpolated strings).

// Extracts every <AMOUNT>...</AMOUNT> value inside a single <VOUCHER>...
// </VOUCHER> block, matched by its VOUCHERNUMBER, and returns the sum of
// debit amounts (ISDEEMEDPOSITIVE=Yes) and credit amounts (=No) separately,
// as absolute values, so tests can assert debit === credit without caring
// about Tally's negative/positive sign convention.
function voucherDebitCreditTotals(xml: string, voucherNumber: string) {
  const voucherRegex = new RegExp(
    `<VOUCHER[^>]*>[\\s\\S]*?<VOUCHERNUMBER>${voucherNumber}</VOUCHERNUMBER>[\\s\\S]*?</VOUCHER>`,
  );
  const match = xml.match(voucherRegex);
  expect(match).not.toBeNull();
  const voucherBlock = match![0];

  const entryRegex =
    /<ALLLEDGERENTRIES\.LIST>[\s\S]*?<LEDGERNAME>(.*?)<\/LEDGERNAME>[\s\S]*?<ISDEEMEDPOSITIVE>(Yes|No)<\/ISDEEMEDPOSITIVE>[\s\S]*?<AMOUNT>(-?\d+\.\d+)<\/AMOUNT>[\s\S]*?<\/ALLLEDGERENTRIES\.LIST>/g;

  let debitTotal = 0;
  let creditTotal = 0;
  const ledgerNames: string[] = [];
  let entryMatch: RegExpExecArray | null;
  while ((entryMatch = entryRegex.exec(voucherBlock)) !== null) {
    const [, ledgerName, isDeemedPositive, amountStr] = entryMatch;
    ledgerNames.push(ledgerName);
    const amount = Math.abs(parseFloat(amountStr));
    if (isDeemedPositive === 'Yes') {
      debitTotal += amount;
    } else {
      creditTotal += amount;
    }
  }

  return { debitTotal, creditTotal, ledgerNames };
}

function account(overrides: Partial<LedgerAccountForExport> = {}): LedgerAccountForExport {
  return {
    name: 'Cash',
    group: 'CASH_IN_HAND',
    openingBalance: 0,
    openingBalanceType: 'DEBIT',
    ...overrides,
  };
}

describe('buildTallyExportXml', () => {
  const companyName = 'Test Pump Pvt Ltd';

  it('produces a balanced Sales voucher for a single-ledger-pair cash sale', () => {
    const voucher: VoucherForExport = {
      voucherNumber: 'PUMP001-V-000001',
      date: new Date('2026-07-01T10:00:00'),
      voucherType: 'SALES',
      narration: 'Bill PUMP001-000001',
      lines: [
        { ledgerAccountName: 'Cash', amount: 500, drCr: 'DEBIT', narration: null },
        { ledgerAccountName: 'Sales', amount: 500, drCr: 'CREDIT', narration: null },
      ],
    };

    const xml = buildTallyExportXml({
      companyName,
      ledgerAccounts: [account(), account({ name: 'Sales', group: 'SALES' })],
      vouchers: [voucher],
    });

    expect(xml).toContain('VCHTYPE="Sales"');
    const { debitTotal, creditTotal, ledgerNames } = voucherDebitCreditTotals(
      xml,
      'PUMP001-V-000001',
    );
    expect(debitTotal).toBeCloseTo(creditTotal, 2);
    expect(debitTotal).toBeCloseTo(500, 2);
    expect(ledgerNames).toEqual(expect.arrayContaining(['Cash', 'Sales']));
  });

  it('produces a balanced Purchase voucher against a per-supplier Sundry Creditor ledger', () => {
    const voucher: VoucherForExport = {
      voucherNumber: 'PUMP001-V-000002',
      date: new Date('2026-07-02T11:00:00'),
      voucherType: 'PURCHASE',
      narration: 'BPCL Distributor — Invoice INV-77',
      lines: [
        { ledgerAccountName: 'Purchase', amount: 180000, drCr: 'DEBIT', narration: null },
        {
          ledgerAccountName: 'BPCL Distributor',
          amount: 180000,
          drCr: 'CREDIT',
          narration: null,
        },
      ],
    };

    const xml = buildTallyExportXml({
      companyName,
      ledgerAccounts: [
        account({ name: 'Purchase', group: 'PURCHASE' }),
        account({ name: 'BPCL Distributor', group: 'SUNDRY_CREDITOR' }),
      ],
      vouchers: [voucher],
    });

    expect(xml).toContain('VCHTYPE="Purchase"');
    const { debitTotal, creditTotal, ledgerNames } = voucherDebitCreditTotals(
      xml,
      'PUMP001-V-000002',
    );
    expect(debitTotal).toBeCloseTo(creditTotal, 2);
    expect(ledgerNames).toContain('BPCL Distributor');
    expect(xml).toContain('<NAME>BPCL Distributor</NAME>');
    expect(xml).toContain('<PARENT>Sundry Creditors</PARENT>');
  });

  it('produces a balanced Receipt voucher for a payment against a customer', () => {
    const voucher: VoucherForExport = {
      voucherNumber: 'PUMP001-V-000003',
      date: new Date('2026-07-05T14:00:00'),
      voucherType: 'RECEIPT',
      narration: 'Payment received from Suresh Traders',
      lines: [
        { ledgerAccountName: 'Cash', amount: 750, drCr: 'DEBIT', narration: null },
        { ledgerAccountName: 'Suresh Traders', amount: 750, drCr: 'CREDIT', narration: null },
      ],
    };

    const xml = buildTallyExportXml({
      companyName,
      ledgerAccounts: [account(), account({ name: 'Suresh Traders', group: 'SUNDRY_DEBTOR' })],
      vouchers: [voucher],
    });

    expect(xml).toContain('VCHTYPE="Receipt"');
    const { debitTotal, creditTotal, ledgerNames } = voucherDebitCreditTotals(
      xml,
      'PUMP001-V-000003',
    );
    expect(debitTotal).toBeCloseTo(creditTotal, 2);
    expect(debitTotal).toBeCloseTo(750, 2);
    expect(ledgerNames).toEqual(expect.arrayContaining(['Cash', 'Suresh Traders']));
  });

  // Section 12 fix — a MANUAL voucher (Toll paid in cash, entered via
  // Voucher Entry, never touching Bill/Payment at all) now shows up in the
  // export, closing the exact gap finding #4 described.
  it('exports a manual (non-Bill/Payment-sourced) voucher just like any other', () => {
    const voucher: VoucherForExport = {
      voucherNumber: 'PUMP001-V-000004',
      date: new Date('2026-07-06T09:00:00'),
      voucherType: 'PAYMENT',
      narration: 'Toll for JEEP 0711',
      lines: [
        { ledgerAccountName: 'Toll', amount: 500, drCr: 'DEBIT', narration: null },
        { ledgerAccountName: 'Cash', amount: 500, drCr: 'CREDIT', narration: null },
      ],
    };

    const xml = buildTallyExportXml({
      companyName,
      ledgerAccounts: [account(), account({ name: 'Toll', group: 'DIRECT_EXPENSE' })],
      vouchers: [voucher],
    });

    expect(xml).toContain('VCHTYPE="Payment"');
    const { debitTotal, creditTotal } = voucherDebitCreditTotals(xml, 'PUMP001-V-000004');
    expect(debitTotal).toBeCloseTo(creditTotal, 2);
    expect(debitTotal).toBeCloseTo(500, 2);
  });

  it('emits every active ledger as a master with its opening balance, even ones untouched in this date range', () => {
    const xml = buildTallyExportXml({
      companyName,
      ledgerAccounts: [
        account({ name: 'SBI', group: 'BANK', openingBalance: 1200, openingBalanceType: 'DEBIT' }),
      ],
      vouchers: [],
    });

    expect(xml).toContain('<NAME>SBI</NAME>');
    expect(xml).toContain('<PARENT>Bank Accounts</PARENT>');
    expect(xml).toContain('<OPENINGBALANCE>1200.00</OPENINGBALANCE>');
  });

  it('writes a CREDIT-type opening balance as a negative OPENINGBALANCE', () => {
    const xml = buildTallyExportXml({
      companyName,
      ledgerAccounts: [
        account({
          name: 'BPCL Distributor',
          group: 'SUNDRY_CREDITOR',
          openingBalance: 5000,
          openingBalanceType: 'CREDIT',
        }),
      ],
      vouchers: [],
    });

    expect(xml).toContain('<OPENINGBALANCE>-5000.00</OPENINGBALANCE>');
  });

  it('escapes XML special characters in a ledger name containing & and <', () => {
    const xml = buildTallyExportXml({
      companyName,
      ledgerAccounts: [account({ name: 'Bharat & Sons <Traders>', group: 'SUNDRY_DEBTOR' })],
      vouchers: [],
    });

    expect(xml).not.toContain('Bharat & Sons <Traders>');
    expect(xml).toContain('Bharat &amp; Sons &lt;Traders&gt;');
  });

  it('escapeXml escapes all five XML special characters', () => {
    expect(escapeXml(`& < > " '`)).toBe('&amp; &lt; &gt; &quot; &apos;');
  });

  it('emits the company name in SVCURRENTCOMPANY', () => {
    const xml = buildTallyExportXml({ companyName, ledgerAccounts: [], vouchers: [] });
    expect(xml).toContain(`<SVCURRENTCOMPANY>${companyName}</SVCURRENTCOMPANY>`);
  });

  it('skips a voucher whose lines are all negligible (rounding-noise) amounts', () => {
    const voucher: VoucherForExport = {
      voucherNumber: 'PUMP001-V-000005',
      date: new Date('2026-07-07T09:00:00'),
      voucherType: 'JOURNAL',
      narration: null,
      lines: [
        { ledgerAccountName: 'Cash', amount: 0.001, drCr: 'DEBIT', narration: null },
        { ledgerAccountName: 'Sales', amount: 0.001, drCr: 'CREDIT', narration: null },
      ],
    };

    const xml = buildTallyExportXml({ companyName, ledgerAccounts: [], vouchers: [voucher] });

    expect(xml).not.toContain('PUMP001-V-000005');
  });
});
