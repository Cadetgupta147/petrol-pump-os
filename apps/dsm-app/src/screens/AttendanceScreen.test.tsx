import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { AttendanceScreen } from './AttendanceScreen';
import type { StaffSummary } from '../api/authApi';
import type { AttendanceLog } from '../api/attendanceApi';

// All three are real network-calling functions in production; every test in
// this file exercises the UI/state layer only, never an actual fetch.
jest.mock('../api/attendanceApi', () => {
  const actual = jest.requireActual<typeof import('../api/attendanceApi')>('../api/attendanceApi');
  return { ...actual, getMyAttendanceStatus: jest.fn(), clockIn: jest.fn(), clockOut: jest.fn() };
});

import { clockIn, clockOut, getMyAttendanceStatus } from '../api/attendanceApi';

const mockGetMyAttendanceStatus = getMyAttendanceStatus as jest.MockedFunction<typeof getMyAttendanceStatus>;
const mockClockIn = clockIn as jest.MockedFunction<typeof clockIn>;
const mockClockOut = clockOut as jest.MockedFunction<typeof clockOut>;

const staff: StaffSummary = { id: 'staff-1', name: 'Test DSM', role: 'DSM' };

function fakeLog(overrides: Partial<AttendanceLog> = {}): AttendanceLog {
  return {
    id: 'log-1',
    staffId: 'staff-1',
    clockIn: '2026-07-27T08:00:00.000Z',
    clockOut: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('AttendanceScreen', () => {
  it('shows "Not clocked in" and a Clock In button when there is no open session', async () => {
    mockGetMyAttendanceStatus.mockResolvedValue({ openLog: null });

    const { getByText, getByTestId } = render(
      <AttendanceScreen staff={staff} accessToken="tok" onBack={jest.fn()} />,
    );

    await waitFor(() => expect(getByText('Not clocked in')).toBeTruthy());
    expect(getByTestId('attendance-toggle-button')).toBeTruthy();
    expect(getByText('Clock In')).toBeTruthy();
  });

  it('shows the clock-in time and a Clock Out button when a session is open', async () => {
    mockGetMyAttendanceStatus.mockResolvedValue({ openLog: fakeLog() });

    const { getByTestId, getByText } = render(
      <AttendanceScreen staff={staff} accessToken="tok" onBack={jest.fn()} />,
    );

    await waitFor(() => expect(getByTestId('attendance-status')).toBeTruthy());
    expect(getByText(/Clocked in since/)).toBeTruthy();
    expect(getByText('Clock Out')).toBeTruthy();
  });

  it('clocks in and flips the button to Clock Out', async () => {
    mockGetMyAttendanceStatus.mockResolvedValue({ openLog: null });
    mockClockIn.mockResolvedValue(fakeLog());

    const { getByTestId, getByText } = render(
      <AttendanceScreen staff={staff} accessToken="tok" onBack={jest.fn()} />,
    );

    await waitFor(() => expect(getByText('Clock In')).toBeTruthy());
    fireEvent.press(getByTestId('attendance-toggle-button'));

    await waitFor(() => expect(mockClockIn).toHaveBeenCalledWith('tok'));
    await waitFor(() => expect(getByText('Clock Out')).toBeTruthy());
  });

  it('clocks out using the open log id and flips the button back to Clock In', async () => {
    mockGetMyAttendanceStatus.mockResolvedValue({ openLog: fakeLog() });
    mockClockOut.mockResolvedValue(fakeLog({ clockOut: '2026-07-27T16:00:00.000Z' }));

    const { getByTestId, getByText } = render(
      <AttendanceScreen staff={staff} accessToken="tok" onBack={jest.fn()} />,
    );

    await waitFor(() => expect(getByText('Clock Out')).toBeTruthy());
    fireEvent.press(getByTestId('attendance-toggle-button'));

    await waitFor(() => expect(mockClockOut).toHaveBeenCalledWith('log-1', 'tok'));
    await waitFor(() => expect(getByText('Not clocked in')).toBeTruthy());
  });

  it('shows a server error message when clock-in is rejected', async () => {
    mockGetMyAttendanceStatus.mockResolvedValue({ openLog: null });
    const { AttendanceApiError } = jest.requireActual<typeof import('../api/attendanceApi')>(
      '../api/attendanceApi',
    );
    mockClockIn.mockRejectedValue(new AttendanceApiError('Already clocked in'));

    const { getByTestId, getByText } = render(
      <AttendanceScreen staff={staff} accessToken="tok" onBack={jest.fn()} />,
    );

    await waitFor(() => expect(getByText('Clock In')).toBeTruthy());
    fireEvent.press(getByTestId('attendance-toggle-button'));

    await waitFor(() => expect(getByTestId('attendance-error')).toBeTruthy());
    expect(getByText('Already clocked in')).toBeTruthy();
  });
});
