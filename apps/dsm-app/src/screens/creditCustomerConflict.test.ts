import { hasCreditCustomerConflict } from './creditCustomerConflict';

describe('hasCreditCustomerConflict', () => {
  it('is false when there is no CREDIT line at all', () => {
    expect(
      hasCreditCustomerConflict({
        hasCreditLine: false,
        creditCustomerId: 'cust-a',
        creditQuickAdd: undefined,
        scannedCustomerId: 'cust-b',
      }),
    ).toBe(false);
  });

  it('is false when a CREDIT line exists but no credit customer is attached yet', () => {
    expect(
      hasCreditCustomerConflict({
        hasCreditLine: true,
        creditCustomerId: undefined,
        creditQuickAdd: undefined,
        scannedCustomerId: 'cust-b',
      }),
    ).toBe(false);
  });

  it('is false when the attached credit customer is the same one just scanned', () => {
    expect(
      hasCreditCustomerConflict({
        hasCreditLine: true,
        creditCustomerId: 'cust-a',
        creditQuickAdd: undefined,
        scannedCustomerId: 'cust-a',
      }),
    ).toBe(false);
  });

  it('is true when the attached credit customer differs from the one just scanned', () => {
    expect(
      hasCreditCustomerConflict({
        hasCreditLine: true,
        creditCustomerId: 'cust-a',
        creditQuickAdd: undefined,
        scannedCustomerId: 'cust-b',
      }),
    ).toBe(true);
  });

  it('is true whenever a quick-added credit customer is attached, regardless of who was scanned', () => {
    // A quick-added customer has no persisted id / member ID, so it can
    // never legitimately be "the same person" as a scan result.
    expect(
      hasCreditCustomerConflict({
        hasCreditLine: true,
        creditCustomerId: undefined,
        creditQuickAdd: { name: 'Quick Add Customer', vehicleNumber: 'DL03CC3333' },
        scannedCustomerId: 'cust-b',
      }),
    ).toBe(true);
  });
});
