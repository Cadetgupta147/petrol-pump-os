jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('../api/billsApi', () => {
  const actual = jest.requireActual<typeof import('../api/billsApi')>('../api/billsApi');
  return { ...actual, createBill: jest.fn() };
});

import { render, waitFor, fireEvent } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LoggedInScreen } from './LoggedInScreen';
import type { StaffSummary } from '../api/authApi';
import { createBill, BillsApiError, type CreateBillInput } from '../api/billsApi';
import { enqueueBill } from '../offline/offlineBillQueue';

const mockCreateBill = createBill as jest.MockedFunction<typeof createBill>;

const staff: StaffSummary = { id: 'staff-1', name: 'Test DSM', role: 'DSM' };

const sampleInput: CreateBillInput = {
  vehicleNumber: 'KA01AB1234',
  amount: 1000,
  litres: 20,
  productType: 'petrol',
  entryChannel: 'DSM_APP',
  paymentLines: [{ paymentType: 'CASH', amount: 1000, direction: 'IN' }],
};

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

// Section 17.6 — DSM Home's offline-sync banner. Only positive assertions
// (element present / has this text) — asserting the banner's total ABSENCE
// is timing-fragile against the mount effect's own in-flight sync attempt,
// and the actual queue-draining logic already has direct coverage in
// offlineBillQueue.test.ts; this file only checks the screen wires that
// logic to visible UI correctly.
describe('LoggedInScreen — offline sync banner', () => {
  it('shows the pending count and a Sync now button when a bill is queued', async () => {
    await enqueueBill(sampleInput);
    mockCreateBill.mockRejectedValue(new BillsApiError("can't reach", true));

    const { getByTestId } = render(
      <LoggedInScreen staff={staff} accessToken="tok" onLogOut={jest.fn()} />,
    );

    await waitFor(() => expect(getByTestId('pending-sync-count')).toHaveTextContent('1 bill pending sync'));
    expect(getByTestId('sync-now-button')).toBeTruthy();
  });

  it('shows a confirmation message and drains the queue once Sync now succeeds', async () => {
    await enqueueBill(sampleInput);
    mockCreateBill.mockRejectedValueOnce(new BillsApiError("can't reach", true));

    const { getByTestId } = render(
      <LoggedInScreen staff={staff} accessToken="tok" onLogOut={jest.fn()} />,
    );

    await waitFor(() => expect(getByTestId('pending-sync-count')).toBeTruthy());

    mockCreateBill.mockResolvedValueOnce({ id: 'bill-1' } as never);
    fireEvent.press(getByTestId('sync-now-button'));

    await waitFor(() => expect(getByTestId('pending-sync-count')).toHaveTextContent('Synced 1 bill'));
  });
});
