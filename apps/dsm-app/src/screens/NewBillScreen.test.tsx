import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { NewBillScreen } from './NewBillScreen';
import type { StaffSummary } from '../api/authApi';
import type { Bill } from '../api/billsApi';
import type { CustomerLookup, CustomerSummary } from '../api/customersApi';

// --- Module mocks -----------------------------------------------------
// All three are real network-calling modules in production; every test in
// this file exercises the UI/state layer only, never an actual fetch.

jest.mock('../api/customersApi', () => ({
  hasMemberIdShape: jest.fn(() => true),
  getCustomerByMemberId: jest.fn(),
  listCustomers: jest.fn(),
  CustomersApiError: class CustomersApiError extends Error {},
}));

jest.mock('../api/loyaltyApi', () => ({
  calculatePointsPreview: jest.fn(() => Promise.resolve(null)),
}));

// Every test here drives ScanCustomerModal through its manual member-ID
// fallback input, never the camera — stub the camera bits out so the
// permission hook's real async native-module round trip (which otherwise
// resolves after a test has already finished and unmounted, producing a
// harmless but noisy "not wrapped in act()" warning) never runs.
jest.mock('expo-camera', () => ({
  CameraView: () => null,
  useCameraPermissions: () => [{ granted: false, canAskAgain: false }, jest.fn()],
}));

jest.mock('../api/billsApi', () => {
  const actual = jest.requireActual<typeof import('../api/billsApi')>('../api/billsApi');
  return {
    ...actual,
    createBill: jest.fn(),
  };
});

import { getCustomerByMemberId, listCustomers } from '../api/customersApi';
import { createBill } from '../api/billsApi';

const mockGetCustomerByMemberId = getCustomerByMemberId as jest.MockedFunction<
  typeof getCustomerByMemberId
>;
const mockListCustomers = listCustomers as jest.MockedFunction<typeof listCustomers>;
const mockCreateBill = createBill as jest.MockedFunction<typeof createBill>;

const staff: StaffSummary = { id: 'staff-1', name: 'Test DSM', phone: '9999999999', role: 'DSM' };

const CUSTOMER_A: CustomerSummary = {
  id: 'cust-a',
  name: 'Customer A',
  phone: null,
  vehicleNumber: 'DL01AA1111',
  qrMemberId: 'PUMP001-CUST-00001-1',
  creditLimit: 5000,
  verificationStatus: 'VERIFIED',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const CUSTOMER_B_LOOKUP: CustomerLookup = {
  customerId: 'cust-b',
  qrMemberId: 'PUMP001-CUST-00002-2',
  name: 'Customer B',
  vehicleNumber: 'DL02BB2222',
  verificationStatus: 'VERIFIED',
};

function fakeBill(overrides: Partial<Bill> = {}): Bill {
  return {
    id: 'bill-1',
    customerId: null,
    vehicleNumber: 'DL01AA1111',
    customerName: null,
    amount: 500,
    litres: 10,
    productType: 'PETROL',
    rateApplied: 50,
    enteredById: staff.id,
    entryChannel: 'DSM_APP',
    timestamp: '2026-07-20T10:00:00.000Z',
    loyaltyPointsEarned: 0,
    loyaltyBasisUsed: null,
    paymentLines: [{ id: 'line-1', billId: 'bill-1', paymentType: 'CREDIT', amount: 500, direction: 'IN' }],
    ...overrides,
  };
}

function fillBaseBillFields(getByTestId: ReturnType<typeof render>['getByTestId']) {
  fireEvent.changeText(getByTestId('amount-input'), '500');
  fireEvent.changeText(getByTestId('litres-input'), '10');
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetCustomerByMemberId.mockReset();
  mockListCustomers.mockReset();
  mockCreateBill.mockReset();
});

// Note: the pure hasCreditCustomerConflict decision rule has its own direct
// unit tests in ./creditCustomerConflict.test.ts. Everything below exercises
// the rule wired up through the real screen/modals.

// -----------------------------------------------------------------------
// (a) Full interaction test — scan-after-picker-select with a mismatched
// existing CREDIT line must block, not reattribute.
// -----------------------------------------------------------------------
describe('NewBillScreen — credit-attribution conflict on scan', () => {
  it('blocks a scan resolving to a different customer than an existing CREDIT line, and keeps the original customer attributed', async () => {
    mockListCustomers.mockResolvedValue([CUSTOMER_A]);
    mockGetCustomerByMemberId.mockResolvedValue(CUSTOMER_B_LOOKUP);
    mockCreateBill.mockResolvedValue(fakeBill({ customerId: 'cust-a' }));

    const { getByTestId, queryByTestId } = render(
      <NewBillScreen staff={staff} accessToken="token" onBack={jest.fn()} />,
    );

    fillBaseBillFields(getByTestId);
    fireEvent.changeText(getByTestId('vehicle-number-input'), 'DL01AA1111');

    // Open Add Payment, pick CREDIT — no credit customer resolved yet, so
    // this opens the credit picker.
    fireEvent.press(getByTestId('add-payment-button'));
    fireEvent.press(getByTestId('payment-method-CREDIT'));
    fireEvent.changeText(getByTestId('payment-amount-input'), '500');
    fireEvent.press(getByTestId('confirm-add-payment-button'));

    // Credit picker opens and loads customers — select Customer A.
    await waitFor(() => expect(getByTestId('credit-customer-cust-a')).toBeTruthy());
    fireEvent.press(getByTestId('credit-customer-cust-a'));

    // The CREDIT line for Customer A is now on the bill.
    await waitFor(() => expect(getByTestId('credit-customer-label')).toBeTruthy());
    expect(getByTestId('credit-customer-label')).toHaveTextContent(/Customer A/);

    // Now scan a QR that resolves to a *different* customer, Customer B.
    fireEvent.press(getByTestId('scan-qr-button'));
    fireEvent.changeText(getByTestId('manual-member-id-input'), CUSTOMER_B_LOOKUP.qrMemberId);
    fireEvent.press(getByTestId('manual-lookup-button'));

    // Blocked: a visible error appears, the scan modal doesn't leave a
    // scanned customer attached, and Customer A is still the one shown.
    await waitFor(() => expect(getByTestId('scan-conflict-error')).toBeTruthy());
    expect(getByTestId('scan-conflict-error')).toHaveTextContent(/Customer A/);
    expect(queryByTestId('scanned-customer-chip')).toBeNull();
    expect(getByTestId('credit-customer-label')).toHaveTextContent(/Customer A/);

    // And the bill's eventual customerId is unaffected — still Customer A.
    // (If Save were still disabled, this press would be a no-op and the
    // waitFor below would time out — that failure mode is exercised by the
    // canSave logic itself elsewhere, not re-asserted separately here.)
    fireEvent.press(getByTestId('save-bill-button'));

    await waitFor(() => expect(mockCreateBill).toHaveBeenCalledTimes(1));
    const [submittedInput] = mockCreateBill.mock.calls[0];
    expect(submittedInput.customerId).toBe('cust-a');
    expect(submittedInput.quickAddCustomer).toBeUndefined();
  });

  it('allows scanning the very same customer already attached as the CREDIT customer (no-op replace)', async () => {
    mockListCustomers.mockResolvedValue([CUSTOMER_A]);
    mockGetCustomerByMemberId.mockResolvedValue({
      customerId: 'cust-a',
      qrMemberId: CUSTOMER_A.qrMemberId,
      name: CUSTOMER_A.name,
      vehicleNumber: CUSTOMER_A.vehicleNumber,
      verificationStatus: 'VERIFIED',
    });

    const { getByTestId, queryByTestId } = render(
      <NewBillScreen staff={staff} accessToken="token" onBack={jest.fn()} />,
    );

    fillBaseBillFields(getByTestId);
    fireEvent.press(getByTestId('add-payment-button'));
    fireEvent.press(getByTestId('payment-method-CREDIT'));
    fireEvent.changeText(getByTestId('payment-amount-input'), '500');
    fireEvent.press(getByTestId('confirm-add-payment-button'));
    await waitFor(() => expect(getByTestId('credit-customer-cust-a')).toBeTruthy());
    fireEvent.press(getByTestId('credit-customer-cust-a'));
    await waitFor(() => expect(getByTestId('credit-customer-label')).toBeTruthy());

    fireEvent.press(getByTestId('scan-qr-button'));
    fireEvent.changeText(getByTestId('manual-member-id-input'), CUSTOMER_A.qrMemberId);
    fireEvent.press(getByTestId('manual-lookup-button'));

    await waitFor(() => expect(getByTestId('scanned-customer-chip')).toBeTruthy());
    expect(queryByTestId('scan-conflict-error')).toBeNull();
    // Straightforward replace: creditCustomerId/creditQuickAdd/label are all
    // cleared together once the scanned customer takes over the slot (same
    // underlying person, no reattribution) — the "Credit customer" row
    // itself still renders because hasCreditCustomer is now true via the
    // scanned customer, but it must no longer show the stale picker label.
    expect(getByTestId('credit-customer-label')).not.toHaveTextContent(/Customer A/);
  });

  it('does not block/regress a normal scan when there is no CREDIT line at all', async () => {
    mockGetCustomerByMemberId.mockResolvedValue(CUSTOMER_B_LOOKUP);

    const { getByTestId, queryByTestId } = render(
      <NewBillScreen staff={staff} accessToken="token" onBack={jest.fn()} />,
    );

    fireEvent.press(getByTestId('scan-qr-button'));
    fireEvent.changeText(getByTestId('manual-member-id-input'), CUSTOMER_B_LOOKUP.qrMemberId);
    fireEvent.press(getByTestId('manual-lookup-button'));

    await waitFor(() => expect(getByTestId('scanned-customer-chip')).toBeTruthy());
    expect(queryByTestId('scan-conflict-error')).toBeNull();
  });
});

// -----------------------------------------------------------------------
// (b) creditCustomerLabel must never be left stale wherever
// creditCustomerId/creditQuickAdd get cleared.
// -----------------------------------------------------------------------
describe('NewBillScreen — creditCustomerLabel stays in sync', () => {
  it('clears the label together with the credit customer when the last CREDIT line is removed (handleRemoveLine)', async () => {
    mockListCustomers.mockResolvedValue([CUSTOMER_A]);

    const { getByTestId, queryByTestId } = render(
      <NewBillScreen staff={staff} accessToken="token" onBack={jest.fn()} />,
    );

    fillBaseBillFields(getByTestId);
    fireEvent.press(getByTestId('add-payment-button'));
    fireEvent.press(getByTestId('payment-method-CREDIT'));
    fireEvent.changeText(getByTestId('payment-amount-input'), '500');
    fireEvent.press(getByTestId('confirm-add-payment-button'));
    await waitFor(() => expect(getByTestId('credit-customer-cust-a')).toBeTruthy());
    fireEvent.press(getByTestId('credit-customer-cust-a'));
    await waitFor(() => expect(getByTestId('credit-customer-label')).toBeTruthy());

    // There is exactly one payment line (the CREDIT line just added) — its
    // "Remove" control matches this testID pattern uniquely.
    fireEvent.press(getByTestId(/^remove-line-/));

    expect(queryByTestId('credit-customer-label')).toBeNull();
  });

  // Note: the "allows scanning the very same customer already attached..."
  // test above already exercises handleCustomerResolved's non-conflict
  // clearing branch with real (non-empty) creditCustomerId/label values —
  // in the normal UI flow, a credit customer only ever becomes attached in
  // the same handleAdd() call that also adds its CREDIT line, so there's no
  // reachable "credit customer attached, no CREDIT line yet" intermediate
  // state to separately exercise here.

  it('clears the label on resetForm after a successful save', async () => {
    mockListCustomers.mockResolvedValue([CUSTOMER_A]);
    mockCreateBill.mockResolvedValue(fakeBill({ customerId: 'cust-a' }));

    const { getByTestId, queryByTestId } = render(
      <NewBillScreen staff={staff} accessToken="token" onBack={jest.fn()} />,
    );

    fillBaseBillFields(getByTestId);
    fireEvent.changeText(getByTestId('vehicle-number-input'), 'DL01AA1111');
    fireEvent.press(getByTestId('add-payment-button'));
    fireEvent.press(getByTestId('payment-method-CREDIT'));
    fireEvent.changeText(getByTestId('payment-amount-input'), '500');
    fireEvent.press(getByTestId('confirm-add-payment-button'));
    await waitFor(() => expect(getByTestId('credit-customer-cust-a')).toBeTruthy());
    fireEvent.press(getByTestId('credit-customer-cust-a'));
    await waitFor(() => expect(getByTestId('credit-customer-label')).toBeTruthy());

    fireEvent.press(getByTestId('save-bill-button'));
    await waitFor(() => expect(getByTestId('bill-success')).toBeTruthy());

    fireEvent.press(getByTestId('new-bill-again-button'));

    expect(queryByTestId('credit-customer-label')).toBeNull();
    expect(queryByTestId('scanned-customer-chip')).toBeNull();
    expect(getByTestId('scan-qr-button')).toBeTruthy();
  });
});
