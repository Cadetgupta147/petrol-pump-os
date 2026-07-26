import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ShiftSalesSummaryScreen } from './ShiftSalesSummaryScreen';
import type { StaffSummary } from '../api/authApi';
import type { MeterReading } from '../api/meterReadingsApi';
import type { ShiftSalesSummary } from '../api/shiftSalesApi';

// --- Module mocks -----------------------------------------------------
// All three are real network-calling modules in production; every test in
// this file exercises the UI/state layer only, never an actual fetch.

jest.mock('../api/meterReadingsApi', () => {
  const actual = jest.requireActual<typeof import('../api/meterReadingsApi')>(
    '../api/meterReadingsApi',
  );
  return { ...actual, listMeterReadings: jest.fn() };
});

jest.mock('../api/shiftSalesApi', () => {
  const actual = jest.requireActual<typeof import('../api/shiftSalesApi')>('../api/shiftSalesApi');
  return {
    ...actual,
    listShiftSalesSummaries: jest.fn(),
    createShiftSalesSummary: jest.fn(),
    updateShiftSalesSummary: jest.fn(),
  };
});

jest.mock('../api/upiCaptureConfigApi', () => {
  const actual = jest.requireActual<typeof import('../api/upiCaptureConfigApi')>(
    '../api/upiCaptureConfigApi',
  );
  return { ...actual, getUpiCaptureConfig: jest.fn() };
});

import { listMeterReadings } from '../api/meterReadingsApi';
import {
  createShiftSalesSummary,
  listShiftSalesSummaries,
  updateShiftSalesSummary,
} from '../api/shiftSalesApi';
import { getUpiCaptureConfig } from '../api/upiCaptureConfigApi';

const mockListMeterReadings = listMeterReadings as jest.MockedFunction<typeof listMeterReadings>;
const mockListShiftSalesSummaries = listShiftSalesSummaries as jest.MockedFunction<
  typeof listShiftSalesSummaries
>;
const mockCreateShiftSalesSummary = createShiftSalesSummary as jest.MockedFunction<
  typeof createShiftSalesSummary
>;
const mockUpdateShiftSalesSummary = updateShiftSalesSummary as jest.MockedFunction<
  typeof updateShiftSalesSummary
>;
const mockGetUpiCaptureConfig = getUpiCaptureConfig as jest.MockedFunction<
  typeof getUpiCaptureConfig
>;

const staff: StaffSummary = { id: 'staff-1', name: 'Test DSM', phone: '9999999999', role: 'DSM' };

function fakeReading(overrides: Partial<MeterReading> = {}): MeterReading {
  return {
    id: 'shift-1',
    nozzleId: 'n1',
    nozzle: { id: 'n1', label: 'N1', itemId: 'item-1', item: { id: 'item-1', name: 'Petrol', category: 'FUEL', unit: 'L' }, startingReading: 0, rolloverAt: null, isActive: true, nextOpeningReading: 1500 },
    staffId: 'staff-1',
    openingReading: 1000,
    closingReading: 1500,
    shiftStart: '2026-07-20T06:00:00.000Z',
    shiftEnd: '2026-07-20T14:00:00.000Z',
    litresSold: 500,
    meterRolledOver: false,
    ...overrides,
  };
}

function fakeSummary(overrides: Partial<ShiftSalesSummary> = {}): ShiftSalesSummary {
  return {
    id: 'summary-1',
    shiftId: 'shift-1',
    dsmId: 'staff-1',
    nozzleId: 'n1',
    walkInLitres: 400,
    walkInCashCollected: 30000,
    walkInUpiCollected: 5000,
    walkInCardCollected: 5000,
    expectedValue: 40000,
    variance: 0,
    createdAt: '2026-07-20T14:05:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ShiftSalesSummaryScreen', () => {
  it('shows "Needs shift totals" for a closed shift with no summary yet', async () => {
    mockListMeterReadings.mockResolvedValue([fakeReading()]);
    mockListShiftSalesSummaries.mockResolvedValue([]);
    mockGetUpiCaptureConfig.mockResolvedValue({
      id: 'cfg-1',
      pumpId: 'pump-1',
      autoCaptureEnabled: false,
      provider: null,
      phonePeWebhookUsernameSet: false,
      phonePeWebhookPasswordSet: false,
      paytmMerchantKeySet: false,
      updatedAt: '2026-07-20T00:00:00.000Z',
    });

    const { getByText, getByTestId } = render(
      <ShiftSalesSummaryScreen staff={staff} accessToken="tok" onBack={jest.fn()} />,
    );

    await waitFor(() => expect(getByText('Needs shift totals')).toBeTruthy());
    expect(getByTestId('enter-totals-N1')).toBeTruthy();
  });

  it('submits cash/card/UPI manually when auto-capture is off', async () => {
    mockListMeterReadings.mockResolvedValue([fakeReading()]);
    mockListShiftSalesSummaries.mockResolvedValue([]);
    mockGetUpiCaptureConfig.mockResolvedValue({
      id: 'cfg-1',
      pumpId: 'pump-1',
      autoCaptureEnabled: false,
      provider: null,
      phonePeWebhookUsernameSet: false,
      phonePeWebhookPasswordSet: false,
      paytmMerchantKeySet: false,
      updatedAt: '2026-07-20T00:00:00.000Z',
    });
    mockCreateShiftSalesSummary.mockResolvedValue(fakeSummary());

    const { getByTestId, queryByTestId } = render(
      <ShiftSalesSummaryScreen staff={staff} accessToken="tok" onBack={jest.fn()} />,
    );

    await waitFor(() => expect(getByTestId('enter-totals-N1')).toBeTruthy());
    fireEvent.press(getByTestId('enter-totals-N1'));

    // UPI is editable (auto-capture off) — no read-only element rendered.
    expect(queryByTestId('upi-readonly-N1')).toBeNull();

    fireEvent.changeText(getByTestId('cash-input-N1'), '30000');
    fireEvent.changeText(getByTestId('card-input-N1'), '5000');
    fireEvent.changeText(getByTestId('upi-input-N1'), '5000');
    fireEvent.press(getByTestId('submit-totals-N1'));

    await waitFor(() =>
      expect(mockCreateShiftSalesSummary).toHaveBeenCalledWith(
        {
          shiftId: 'shift-1',
          walkInCashCollected: 30000,
          walkInCardCollected: 5000,
          walkInUpiCollected: 5000,
        },
        'tok',
      ),
    );
  });

  it('omits walkInUpiCollected entirely and shows it read-only when auto-capture is on', async () => {
    mockListMeterReadings.mockResolvedValue([fakeReading()]);
    mockListShiftSalesSummaries.mockResolvedValue([]);
    mockGetUpiCaptureConfig.mockResolvedValue({
      id: 'cfg-1',
      pumpId: 'pump-1',
      autoCaptureEnabled: true,
      provider: 'PHONEPE',
      phonePeWebhookUsernameSet: true,
      phonePeWebhookPasswordSet: true,
      paytmMerchantKeySet: false,
      updatedAt: '2026-07-20T00:00:00.000Z',
    });
    mockCreateShiftSalesSummary.mockResolvedValue(fakeSummary({ walkInUpiCollected: 0 }));

    const { getByTestId, queryByTestId } = render(
      <ShiftSalesSummaryScreen staff={staff} accessToken="tok" onBack={jest.fn()} />,
    );

    await waitFor(() => expect(getByTestId('enter-totals-N1')).toBeTruthy());
    fireEvent.press(getByTestId('enter-totals-N1'));

    expect(getByTestId('upi-readonly-N1')).toBeTruthy();
    expect(queryByTestId('upi-input-N1')).toBeNull();

    fireEvent.changeText(getByTestId('cash-input-N1'), '30000');
    fireEvent.changeText(getByTestId('card-input-N1'), '5000');
    fireEvent.press(getByTestId('submit-totals-N1'));

    await waitFor(() =>
      expect(mockCreateShiftSalesSummary).toHaveBeenCalledWith(
        { shiftId: 'shift-1', walkInCashCollected: 30000, walkInCardCollected: 5000 },
        'tok',
      ),
    );
  });

  it('edits an existing summary via PATCH, pre-filled with its current values', async () => {
    mockListMeterReadings.mockResolvedValue([fakeReading()]);
    mockListShiftSalesSummaries.mockResolvedValue([fakeSummary()]);
    mockGetUpiCaptureConfig.mockResolvedValue({
      id: 'cfg-1',
      pumpId: 'pump-1',
      autoCaptureEnabled: false,
      provider: null,
      phonePeWebhookUsernameSet: false,
      phonePeWebhookPasswordSet: false,
      paytmMerchantKeySet: false,
      updatedAt: '2026-07-20T00:00:00.000Z',
    });
    mockUpdateShiftSalesSummary.mockResolvedValue(fakeSummary({ walkInCashCollected: 32000 }));

    const { getByTestId, getByText } = render(
      <ShiftSalesSummaryScreen staff={staff} accessToken="tok" onBack={jest.fn()} />,
    );

    await waitFor(() => expect(getByText(/Cash ₹30000/)).toBeTruthy());
    fireEvent.press(getByTestId('enter-totals-N1'));

    expect(getByTestId('cash-input-N1').props.value).toBe('30000');

    fireEvent.changeText(getByTestId('cash-input-N1'), '32000');
    fireEvent.press(getByTestId('submit-totals-N1'));

    await waitFor(() =>
      expect(mockUpdateShiftSalesSummary).toHaveBeenCalledWith(
        'summary-1',
        { walkInCashCollected: 32000, walkInCardCollected: 5000, walkInUpiCollected: 5000 },
        'tok',
      ),
    );
  });
});
