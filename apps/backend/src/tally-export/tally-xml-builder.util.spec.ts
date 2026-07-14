import {
  BillForExport,
  PaymentForExport,
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

describe('buildTallyExportXml', () => {
  const companyName = 'Test Pump Pvt Ltd';

  it('produces a balanced Sales Voucher for a single-bill cash payment', () => {
    const bill: BillForExport = {
      id: 'bill-1',
      timestamp: new Date('2026-07-01T10:00:00'),
      amount: 500,
      customerName: 'Walk-in',
      vehicleNumber: null,
      customer: null,
      paymentLines: [
        { paymentType: 'CASH', amount: 500, direction: 'IN' },
      ],
    };

    const xml = buildTallyExportXml({ companyName, bills: [bill], payments: [] });

    expect(xml).toContain('VCHTYPE="Sales"');

    const { debitTotal, creditTotal, ledgerNames } =
      voucherDebitCreditTotals(xml, 'bill-1');
    expect(debitTotal).toBeCloseTo(creditTotal, 2);
    expect(debitTotal).toBeCloseTo(500, 2);
    expect(ledgerNames).toContain('Cash');
    expect(ledgerNames).toContain('Sales Account');
  });

  it('produces a balanced Sales Voucher for a split cash+UPI bill', () => {
    const bill: BillForExport = {
      id: 'bill-2',
      timestamp: new Date('2026-07-02T11:00:00'),
      amount: 450,
      customerName: null,
      vehicleNumber: 'KA-01-AB-1234',
      customer: null,
      paymentLines: [
        { paymentType: 'CASH', amount: 300, direction: 'IN' },
        { paymentType: 'UPI', amount: 150, direction: 'IN' },
      ],
    };

    const xml = buildTallyExportXml({ companyName, bills: [bill], payments: [] });
    const { debitTotal, creditTotal, ledgerNames } =
      voucherDebitCreditTotals(xml, 'bill-2');

    expect(debitTotal).toBeCloseTo(creditTotal, 2);
    expect(debitTotal).toBeCloseTo(450, 2);
    expect(ledgerNames).toEqual(
      expect.arrayContaining(['Cash', 'UPI', 'Sales Account']),
    );
  });

  it('still balances a split bill where one payment type nets negative (overpay + change given back)', () => {
    // Customer pays 500 by UPI against a 450 bill, gets 50 cash change back.
    const bill: BillForExport = {
      id: 'bill-3',
      timestamp: new Date('2026-07-03T12:00:00'),
      amount: 450,
      customerName: 'Change Customer',
      vehicleNumber: null,
      customer: null,
      paymentLines: [
        { paymentType: 'UPI', amount: 500, direction: 'IN' },
        { paymentType: 'CASH', amount: 50, direction: 'OUT' },
      ],
    };

    const xml = buildTallyExportXml({ companyName, bills: [bill], payments: [] });
    const { debitTotal, creditTotal } = voucherDebitCreditTotals(xml, 'bill-3');

    expect(debitTotal).toBeCloseTo(creditTotal, 2);
    expect(debitTotal).toBeCloseTo(500, 2); // UPI debit 500 = CASH credit 50 + Sales credit 450
  });

  it('maps a CREDIT bill line to the specific customer ledger, not a static ledger', () => {
    const bill: BillForExport = {
      id: 'bill-4',
      timestamp: new Date('2026-07-04T09:00:00'),
      amount: 1000,
      customerName: 'Ramesh Transports',
      vehicleNumber: null,
      customer: { id: 'cust-1', name: 'Ramesh Transports' },
      paymentLines: [
        { paymentType: 'CREDIT', amount: 1000, direction: 'IN' },
      ],
    };

    const xml = buildTallyExportXml({ companyName, bills: [bill], payments: [] });
    const { ledgerNames, debitTotal, creditTotal } =
      voucherDebitCreditTotals(xml, 'bill-4');

    expect(ledgerNames).toContain('Ramesh Transports');
    expect(debitTotal).toBeCloseTo(creditTotal, 2);
    // A ledger master should also have been emitted for this customer.
    expect(xml).toContain('<NAME>Ramesh Transports</NAME>');
    expect(xml).toContain('<PARENT>Sundry Debtors</PARENT>');
  });

  it('produces a balanced Receipt Voucher for a payment against a customer', () => {
    const payment: PaymentForExport = {
      id: 'pay-1',
      createdAt: new Date('2026-07-05T14:00:00'),
      amount: 750,
      method: 'CASH',
      customer: { id: 'cust-2', name: 'Suresh Traders' },
    };

    const xml = buildTallyExportXml({ companyName, bills: [], payments: [payment] });

    expect(xml).toContain('VCHTYPE="Receipt"');
    const { debitTotal, creditTotal, ledgerNames } =
      voucherDebitCreditTotals(xml, 'pay-1');

    expect(debitTotal).toBeCloseTo(creditTotal, 2);
    expect(debitTotal).toBeCloseTo(750, 2);
    expect(ledgerNames).toEqual(
      expect.arrayContaining(['Cash', 'Suresh Traders']),
    );
  });

  it('escapes XML special characters in a customer name containing & and <', () => {
    const bill: BillForExport = {
      id: 'bill-5',
      timestamp: new Date('2026-07-06T08:00:00'),
      amount: 200,
      customerName: 'Bharat & Sons <Traders>',
      vehicleNumber: null,
      customer: { id: 'cust-3', name: 'Bharat & Sons <Traders>' },
      paymentLines: [
        { paymentType: 'CREDIT', amount: 200, direction: 'IN' },
      ],
    };

    const xml = buildTallyExportXml({ companyName, bills: [bill], payments: [] });

    expect(xml).not.toContain('Bharat & Sons <Traders>');
    expect(xml).toContain('Bharat &amp; Sons &lt;Traders&gt;');
  });

  it('escapeXml escapes all five XML special characters', () => {
    expect(escapeXml(`& < > " '`)).toBe('&amp; &lt; &gt; &quot; &apos;');
  });

  it('emits the company name in SVCURRENTCOMPANY', () => {
    const xml = buildTallyExportXml({ companyName, bills: [], payments: [] });
    expect(xml).toContain(`<SVCURRENTCOMPANY>${companyName}</SVCURRENTCOMPANY>`);
  });
});
