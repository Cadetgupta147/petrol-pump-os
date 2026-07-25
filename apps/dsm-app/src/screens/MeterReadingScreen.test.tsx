import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { MeterReadingScreen } from './MeterReadingScreen';
import type { StaffSummary } from '../api/authApi';
import type { Nozzle } from '../api/nozzlesApi';
import type { MeterReading } from '../api/meterReadingsApi';

// Meter Reading redesign (Section 3.3) — this screen replaced the old
// two-step "pick a nozzle, Open Shift, later Close Shift" flow with a single
// batch submission covering every active nozzle at once. Every API module
// here is a real network-calling module in production; these tests exercise
// the UI/state layer only, never an actual fetch (same convention as
// NewBillScreen.test.tsx).

jest.mock('../api/nozzlesApi', () => ({
  listNozzles: jest.fn(),
  NozzlesApiError: class NozzlesApiError extends Error {},
}));

jest.mock('../api/meterReadingsApi', () => ({
  listMeterReadings: jest.fn(),
  batchClose: jest.fn(),
  MeterReadingsApiError: class MeterReadingsApiError extends Error {},
}));

jest.mock('../api/shiftScheduleApi', () => ({
  getCurrentShiftWindow: jest.fn(() => Promise.resolve(null)),
  ShiftScheduleApiError: class ShiftScheduleApiError extends Error {},
}));

jest.mock('../api/staffApi', () => ({
  listStaff: jest.fn(() => Promise.resolve([])),
  StaffApiError: class StaffApiError extends Error {},
}));

import { listNozzles } from '../api/nozzlesApi';
import { listMeterReadings, batchClose } from '../api/meterReadingsApi';
import { listStaff } from '../api/staffApi';

const mockListNozzles = listNozzles as jest.MockedFunction<typeof listNozzles>;
const mockListMeterReadings = listMeterReadings as jest.MockedFunction<typeof listMeterReadings>;
const mockBatchClose = batchClose as jest.MockedFunction<typeof batchClose>;
const mockListStaff = listStaff as jest.MockedFunction<typeof listStaff>;

const dsmStaff: StaffSummary = { id: 'staff-1', name: 'Test DSM', phone: '9999999999', role: 'DSM' };
const managerStaff: StaffSummary = { id: 'staff-mgr', name: 'Test Manager', phone: '8888888888', role: 'MANAGER' };

const nozzle1: Nozzle = {
  id: 'n1',
  label: 'N1',
  itemId: 'item-1',
  item: { id: 'item-1', name: 'Petrol', category: 'FUEL', unit: 'LITRE' },
  startingReading: 1000,
  rolloverAt: null,
  isActive: true,
  nextOpeningReading: 1000,
};

const nozzle2: Nozzle = {
  id: 'n2',
  label: 'N2',
  itemId: 'item-2',
  item: { id: 'item-2', name: 'Diesel', category: 'FUEL', unit: 'LITRE' },
  startingReading: 2000,
  rolloverAt: null,
  isActive: true,
  nextOpeningReading: 2000,
};

function fakeReading(overrides: Partial<MeterReading> = {}): MeterReading {
  return {
    id: 'mr-1',
    nozzleId: 'n1',
    nozzle: nozzle1,
    staffId: 'staff-1',
    openingReading: 1000,
    closingReading: 1050,
    shiftStart: '2026-07-25T06:00:00.000Z',
    shiftEnd: '2026-07-25T14:00:00.000Z',
    litresSold: 50,
    meterRolledOver: false,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockListNozzles.mockResolvedValue([nozzle1, nozzle2]);
  mockListMeterReadings.mockResolvedValue([]); // no open shifts — every row falls back to nextOpeningReading
  mockListStaff.mockResolvedValue([]);
});

describe('MeterReadingScreen — batch closing readings', () => {
  it("renders one row per active nozzle, pre-filled with each nozzle's opening reading", async () => {
    const { getByTestId } = render(
      <MeterReadingScreen staff={dsmStaff} accessToken="token" onBack={jest.fn()} />,
    );

    await waitFor(() => expect(getByTestId('nozzle-row-N1')).toBeTruthy());
    expect(getByTestId('nozzle-row-N2')).toBeTruthy();
    expect(getByTestId('closing-input-N1').props.value).toBe('1000');
    expect(getByTestId('closing-input-N2').props.value).toBe('2000');
  });

  it('submits closing readings for every nozzle at once, leaving an untouched row at its opening reading (0 litres sold)', async () => {
    mockBatchClose.mockResolvedValue([
      fakeReading({ id: 'mr-n1', nozzleId: 'n1', nozzle: nozzle1, closingReading: 1050, litresSold: 50 }),
      fakeReading({ id: 'mr-n2', nozzleId: 'n2', nozzle: nozzle2, openingReading: 2000, closingReading: 2000, litresSold: 0 }),
    ]);

    const { getByTestId } = render(
      <MeterReadingScreen staff={dsmStaff} accessToken="token" onBack={jest.fn()} />,
    );

    await waitFor(() => expect(getByTestId('submit-batch-button')).toBeTruthy());
    // Only edit N1's closing reading — N2 stays at its pre-filled default.
    fireEvent.changeText(getByTestId('closing-input-N1'), '1050');
    fireEvent.press(getByTestId('submit-batch-button'));

    await waitFor(() => expect(mockBatchClose).toHaveBeenCalledTimes(1));
    const [submittedReadings] = mockBatchClose.mock.calls[0];
    expect(submittedReadings).toEqual([
      { nozzleId: 'n1', closingReading: 1050 },
      { nozzleId: 'n2', closingReading: 2000 },
    ]);
  });

  it("shows each nozzle's litres sold and any tank warning after a successful submit", async () => {
    mockBatchClose.mockResolvedValue([
      fakeReading({ id: 'mr-n1', nozzleId: 'n1', nozzle: nozzle1, litresSold: 50, tankWarning: 'No tank configured for product Petrol' }),
    ]);

    const { getByTestId } = render(
      <MeterReadingScreen staff={dsmStaff} accessToken="token" onBack={jest.fn()} />,
    );

    await waitFor(() => expect(getByTestId('submit-batch-button')).toBeTruthy());
    fireEvent.press(getByTestId('submit-batch-button'));

    await waitFor(() => expect(getByTestId('batch-results')).toBeTruthy());
    expect(getByTestId('batch-results')).toHaveTextContent(/50 L/);
    expect(getByTestId('batch-results')).toHaveTextContent(/No tank configured/);
  });

  it('does not show a per-row staff picker for a DSM caller — attribution is always self', async () => {
    const { getByTestId, queryByTestId } = render(
      <MeterReadingScreen staff={dsmStaff} accessToken="token" onBack={jest.fn()} />,
    );

    await waitFor(() => expect(getByTestId('nozzle-row-N1')).toBeTruthy());
    expect(queryByTestId('staff-picker-N1')).toBeNull();
  });

  it('does not submit while any row has an invalid closing reading', async () => {
    const { getByTestId } = render(
      <MeterReadingScreen staff={dsmStaff} accessToken="token" onBack={jest.fn()} />,
    );

    await waitFor(() => expect(getByTestId('submit-batch-button')).toBeTruthy());
    fireEvent.changeText(getByTestId('closing-input-N1'), 'not-a-number');
    fireEvent.press(getByTestId('submit-batch-button'));

    expect(mockBatchClose).not.toHaveBeenCalled();
  });

  it('lets a non-DSM caller reassign a nozzle row to a different staff member', async () => {
    mockListStaff.mockResolvedValue([
      { id: 'staff-mgr', name: 'Test Manager' },
      { id: 'staff-other', name: 'Other DSM' },
    ]);
    mockBatchClose.mockResolvedValue([fakeReading({ nozzleId: 'n1', nozzle: nozzle1 })]);

    const { getByTestId } = render(
      <MeterReadingScreen staff={managerStaff} accessToken="token" onBack={jest.fn()} />,
    );

    await waitFor(() => expect(getByTestId('staff-picker-N1')).toBeTruthy());
    fireEvent.press(getByTestId('staff-picker-N1'));
    await waitFor(() => expect(getByTestId('staff-option-Other DSM')).toBeTruthy());
    fireEvent.press(getByTestId('staff-option-Other DSM'));

    fireEvent.press(getByTestId('submit-batch-button'));

    await waitFor(() => expect(mockBatchClose).toHaveBeenCalledTimes(1));
    const [submittedReadings] = mockBatchClose.mock.calls[0];
    const n1Entry = submittedReadings.find((reading) => reading.nozzleId === 'n1');
    expect(n1Entry?.staffId).toBe('staff-other');
  });
});
