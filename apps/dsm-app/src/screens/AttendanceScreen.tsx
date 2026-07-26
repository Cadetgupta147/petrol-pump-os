import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { StaffSummary } from '../api/authApi';
import {
  clockIn,
  clockOut,
  getMyAttendanceStatus,
  AttendanceApiError,
  type AttendanceLog,
} from '../api/attendanceApi';

interface Props {
  staff: StaffSummary;
  accessToken: string;
  onBack: () => void;
}

// Section 12 / Section 4 — staff attendance, DSM-app side. The backend only
// exposes an explicit clock-in/clock-out API (not the "derived from first/
// last app activity" model docs/master-plan.md Section 3.7 describes — see
// attendance.service.ts's class comment), so this screen is a plain toggle
// button against that contract, not an automatic activity tracker.
export function AttendanceScreen({ staff, accessToken, onBack }: Props) {
  const [openLog, setOpenLog] = useState<AttendanceLog | null>(null);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function loadStatus() {
    setErrorMessage(null);
    setLoadingInitial(true);
    try {
      const status = await getMyAttendanceStatus(accessToken);
      setOpenLog(status.openLog);
    } catch (error) {
      const message = error instanceof AttendanceApiError ? error.message : 'Something went wrong. Please try again.';
      setErrorMessage(message);
    } finally {
      setLoadingInitial(false);
    }
  }

  useEffect(() => {
    void loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  async function handleToggle() {
    setSubmitting(true);
    setErrorMessage(null);
    try {
      if (openLog) {
        const closed = await clockOut(openLog.id, accessToken);
        setOpenLog(closed.clockOut ? null : closed);
      } else {
        const opened = await clockIn(accessToken);
        setOpenLog(opened);
      }
    } catch (error) {
      const message = error instanceof AttendanceApiError ? error.message : 'Something went wrong. Please try again.';
      setErrorMessage(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Attendance</Text>
      <Text style={styles.detail}>{staff.name}</Text>

      {loadingInitial ? (
        <ActivityIndicator style={{ marginVertical: 16 }} testID="attendance-loading" />
      ) : (
        <Text style={styles.status} testID="attendance-status">
          {openLog
            ? `Clocked in since ${new Date(openLog.clockIn).toLocaleTimeString()}`
            : 'Not clocked in'}
        </Text>
      )}

      {errorMessage ? (
        <Text style={styles.error} testID="attendance-error">
          {errorMessage}
        </Text>
      ) : null}

      {!loadingInitial && (
        <Pressable
          style={[styles.button, submitting && styles.buttonDisabled]}
          onPress={() => {
            void handleToggle();
          }}
          disabled={submitting}
          testID="attendance-toggle-button"
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>{openLog ? 'Clock Out' : 'Clock In'}</Text>
          )}
        </Pressable>
      )}

      <Pressable style={styles.backButton} onPress={onBack} testID="attendance-back-button">
        <Text style={styles.backButtonText}>Back</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  detail: {
    fontSize: 14,
    color: '#555',
    marginBottom: 24,
  },
  status: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 24,
    textAlign: 'center',
  },
  error: {
    color: '#b00020',
    marginBottom: 16,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#1a73e8',
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 32,
    alignItems: 'center',
    width: '100%',
  },
  buttonDisabled: {
    backgroundColor: '#9db8e8',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  backButton: {
    alignItems: 'center',
    marginTop: 24,
  },
  backButtonText: {
    color: '#1a73e8',
    fontSize: 15,
    fontWeight: '600',
  },
});
