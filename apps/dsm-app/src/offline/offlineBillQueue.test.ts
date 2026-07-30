jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('../api/billsApi', () => {
  const actual = jest.requireActual<typeof import('../api/billsApi')>('../api/billsApi');
  return { ...actual, createBill: jest.fn() };
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createBill, BillsApiError, type CreateBillInput } from '../api/billsApi';
import {
  enqueueBill,
  getQueuedBills,
  getPendingCount,
  syncOfflineBills,
  discardFailedBill,
} from './offlineBillQueue';

const mockCreateBill = createBill as jest.MockedFunction<typeof createBill>;

const baseInput: CreateBillInput = {
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

// Section 17.6 — DSM app offline bill queue. Covers: enqueue assigns a
// stable clientRequestId, a successful sync drains the queue, a network
// failure leaves the rest of the queue untouched (no point burning through
// it on one dead connection check), and a real server rejection is kept
// visible as 'failed' rather than silently dropped.
describe('offlineBillQueue', () => {
  it('enqueues a bill with a unique clientRequestId and zero attempts', async () => {
    const queued = await enqueueBill(baseInput);

    expect(queued.clientRequestId).toEqual(expect.any(String));
    expect(queued.attempts).toBe(0);
    expect(queued.status).toBe('pending');

    const all = await getQueuedBills();
    expect(all).toHaveLength(1);
    expect(all[0].clientRequestId).toBe(queued.clientRequestId);
  });

  it('assigns distinct clientRequestIds to successive enqueues', async () => {
    const first = await enqueueBill(baseInput);
    const second = await enqueueBill(baseInput);

    expect(first.clientRequestId).not.toBe(second.clientRequestId);
  });

  it('syncs a pending bill and removes it from the queue on success', async () => {
    await enqueueBill(baseInput);
    mockCreateBill.mockResolvedValue({
      id: 'bill-1',
      billNumber: 'PUMP001-000001',
      customerId: null,
      vehicleNumber: 'KA01AB1234',
      customerName: null,
      amount: 1000,
      litres: 20,
      productType: 'petrol',
      rateApplied: 100,
      enteredById: 'staff-1',
      entryChannel: 'DSM_APP',
      timestamp: '2026-07-27T00:00:00.000Z',
      loyaltyPointsEarned: 0,
      loyaltyBasisUsed: null,
      paymentLines: [],
    });

    const result = await syncOfflineBills('tok');

    expect(result).toEqual({ succeeded: 1, failed: 0, remaining: 0 });
    expect(await getPendingCount()).toBe(0);
    expect(mockCreateBill).toHaveBeenCalledWith(
      expect.objectContaining({ clientRequestId: expect.any(String) as string }),
      'tok',
    );
  });

  it('replays the SAME clientRequestId on every sync attempt for the same queued entry', async () => {
    const queued = await enqueueBill(baseInput);
    mockCreateBill.mockRejectedValueOnce(new BillsApiError("can't reach", true));
    await syncOfflineBills('tok');
    mockCreateBill.mockResolvedValueOnce({ id: 'bill-1' } as never);
    await syncOfflineBills('tok');

    const [firstCallArgs] = mockCreateBill.mock.calls[0];
    const [secondCallArgs] = mockCreateBill.mock.calls[1];
    expect(firstCallArgs.clientRequestId).toBe(queued.clientRequestId);
    expect(secondCallArgs.clientRequestId).toBe(queued.clientRequestId);
  });

  it('keeps a network-failed bill pending and stops attempting the rest of the queue', async () => {
    await enqueueBill(baseInput);
    await enqueueBill(baseInput);
    mockCreateBill.mockRejectedValue(new BillsApiError("can't reach", true));

    const result = await syncOfflineBills('tok');

    expect(result).toEqual({ succeeded: 0, failed: 1, remaining: 2 });
    // Only the first entry was actually attempted — the second was left
    // untouched rather than also failing the same dead-connection check.
    expect(mockCreateBill).toHaveBeenCalledTimes(1);
    const all = await getQueuedBills();
    expect(all[0].status).toBe('pending');
    expect(all[0].attempts).toBe(1);
    expect(all[1].attempts).toBe(0);
  });

  it('marks a server-rejected bill as failed (not dropped) and keeps attempting the rest', async () => {
    await enqueueBill(baseInput);
    await enqueueBill(baseInput);
    mockCreateBill.mockRejectedValueOnce(new BillsApiError('Payment lines do not balance', false));
    mockCreateBill.mockResolvedValueOnce({ id: 'bill-2' } as never);

    const result = await syncOfflineBills('tok');

    expect(result).toEqual({ succeeded: 1, failed: 1, remaining: 1 });
    expect(mockCreateBill).toHaveBeenCalledTimes(2);
    const remaining = await getQueuedBills();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].status).toBe('failed');
    expect(remaining[0].lastError).toBe('Payment lines do not balance');
  });

  it('discards a failed entry but refuses to discard a still-pending one', async () => {
    await enqueueBill(baseInput);
    mockCreateBill.mockRejectedValue(new BillsApiError('rejected', false));
    await syncOfflineBills('tok');

    const [failedEntry] = await getQueuedBills();
    expect(failedEntry.status).toBe('failed');

    await discardFailedBill(failedEntry.clientRequestId);
    expect(await getQueuedBills()).toHaveLength(0);

    await enqueueBill(baseInput);
    const [pendingEntry] = await getQueuedBills();
    await expect(discardFailedBill(pendingEntry.clientRequestId)).rejects.toThrow();
  });
});
