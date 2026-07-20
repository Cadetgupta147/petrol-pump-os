import { parseInvoiceText } from './invoice-text-parser.util';

// Section 9 — pure parser tests against realistic sample text blobs
// (varying supplier-name format, missing fields, a vehicle-number-adjacent
// string, an amount with/without a currency symbol). This is the actual
// rule-heavy logic in the OCR slice — no network mocking needed.
describe('parseInvoiceText', () => {
  it('extracts every field from a well-formed IOCL tanker delivery challan', () => {
    const text = `
      INDIAN OIL CORPORATION LIMITED
      Depot: Panipat
      Challan No: IOCL/2026/00456
      Date: 18/07/2026
      Vehicle No: MH12AB1234
      Product: Diesel (HSD)
      Quantity: 12000 Ltrs
      Rate: Rs 92.50 per Litre
      Total Amount: Rs 1,110,000
    `;

    const result = parseInvoiceText(text);

    expect(result.supplierName).toBe('IOCL (Indian Oil Corporation)');
    expect(result.productType).toBe('diesel');
    expect(result.quantityLitres).toBe(12000);
    expect(result.ratePerLitre).toBe(92.5);
    expect(result.amount).toBe(1110000);
    expect(result.invoiceNo).toBe('IOCL/2026/00456');
    expect(result.tankerNo).toBe('MH12AB1234');
    expect(result.invoiceDate).toBe('18/07/2026');
  });

  it('matches BPCL by its expanded name and HPCL by its abbreviation, independent of format', () => {
    expect(parseInvoiceText('Bharat Petroleum Corporation Ltd\nInvoice').supplierName).toBe(
      'BPCL (Bharat Petroleum)',
    );
    expect(parseInvoiceText('HPCL Depot Sales Invoice').supplierName).toBe(
      'HPCL (Hindustan Petroleum)',
    );
  });

  it('falls back to a "Supplier:" label when no known OMC name is present', () => {
    const text = 'Supplier: Rajesh Fuel Distributors Pvt Ltd\nInvoice No: 991';
    const result = parseInvoiceText(text);
    expect(result.supplierName).toBe('Rajesh Fuel Distributors Pvt Ltd');
  });

  it('returns null supplierName when neither a known OMC name nor a label is found', () => {
    const result = parseInvoiceText('Quantity: 500 Ltrs\nTotal: Rs 50000');
    expect(result.supplierName).toBeNull();
  });

  it('extracts a vehicle number even with spaced-out separators', () => {
    const result = parseInvoiceText('Tanker: MH 12 AB 1234 arrived at gate 2');
    expect(result.tankerNo).toBe('MH12AB1234');
  });

  it('returns null tankerNo when no plate-like pattern is present', () => {
    const result = parseInvoiceText('No vehicle information on this challan');
    expect(result.tankerNo).toBeNull();
  });

  it('extracts an amount tagged with a ₹ symbol', () => {
    const result = parseInvoiceText('Grand Total ₹ 95,500');
    expect(result.amount).toBe(95500);
  });

  it('extracts an amount with no currency symbol at all, via the label-only fallback', () => {
    const result = parseInvoiceText('Total: 95500\nThank you for your business');
    expect(result.amount).toBe(95500);
  });

  it('picks the largest currency-tagged figure when there is no recognizable "Total" label', () => {
    const result = parseInvoiceText('Rate Rs 92.50 per Litre\nPaid Rs 95500 in full');
    expect(result.amount).toBe(95500);
  });

  it('returns nulls for every field on a blank/unrelated string', () => {
    const result = parseInvoiceText('   ');
    expect(result).toEqual({
      supplierName: null,
      productType: null,
      quantityLitres: null,
      ratePerLitre: null,
      amount: null,
      invoiceNo: null,
      tankerNo: null,
      invoiceDate: null,
    });
  });

  it('converts kilolitres to litres for quantity', () => {
    const result = parseInvoiceText('Quantity: 12 KL delivered');
    expect(result.quantityLitres).toBe(12000);
  });

  it('recognizes petrol via the "MS" (motor spirit) abbreviation', () => {
    const result = parseInvoiceText('Product: MS (Petrol)\nQty: 8000 Litres');
    expect(result.productType).toBe('petrol');
    expect(result.quantityLitres).toBe(8000);
  });

  it('extracts an invoice number labelled "Inv No"', () => {
    const result = parseInvoiceText('Inv No: 2026/JULY/0042');
    expect(result.invoiceNo).toBe('2026/JULY/0042');
  });

  it('handles a partially faded/short challan with only a few readable fields', () => {
    // Simulates a thermal-printed challan where most of the text has faded
    // except a couple of lines — Section 9 explicitly expects this to be a
    // partial, human-correctable result, not an error.
    const text = 'Qty 5000 L\n... [faded] ...';
    const result = parseInvoiceText(text);
    expect(result.quantityLitres).toBe(5000);
    expect(result.supplierName).toBeNull();
    expect(result.amount).toBeNull();
    expect(result.invoiceNo).toBeNull();
  });
});
