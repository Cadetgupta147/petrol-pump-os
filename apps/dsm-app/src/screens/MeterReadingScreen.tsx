import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { StaffSummary } from '../api/authApi';
import {
  closeShift,
  listMeterReadings,
  openShift,
  MeterReadingsApiError,
  type MeterReading,
} from '../api/meterReadingsApi';

interface Props {
  staff: StaffSummary;
  accessToken: string;
  onBack: () => void;
}

// Section 3.3 / Section 4 — "Shift start: opening meter reading" and "Shift
// end: closing meter reading" (litres sold auto-computed by the backend).
//
// There is no Nozzle model/endpoint (per task spec) — nozzleId is a
// free-text field, so this is a plain text input, not a picker.
//
// Flow: DSM types a nozzle id and taps "Check Nozzle" — this fetches
// GET /meter-readings and filters client-side for an open shift
// (closingReading === null) on that nozzle, since the backend has no
// ?nozzleId= filter. Depending on what's found, the screen then shows
// either "open a new shift" (no open shift found) or "close this shift"
// (an open shift exists) controls.
export function MeterReadingScreen({ staff, accessToken, onBack }: Props) {
  const [nozzleId, setNozzleId] = useState('');
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  // undefined = not checked yet for the current nozzleId; null = checked,
  // no open shift found; MeterReading = checked, open shift found.
  const [openShiftForNozzle, setOpenShiftForNozzle] = useState<MeterReading | null | undefined>(
    undefined,
  );

  const [openingReadingInput, setOpeningReadingInput] = useState('');
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  const [closingReadingInput, setClosingReadingInput] = useState('');
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [closedResult, setClosedResult] = useState<MeterReading | null>(null);

  const resetCheckState = () => {
    setOpenShiftForNozzle(undefined);
    setCheckError(null);
    setOpenError(null);
    setCloseError(null);
    setClosedResult(null);
    setOpeningReadingInput('');
    setClosingReadingInput('');
  };

  const handleNozzleIdChange = (value: string) => {
    setNozzleId(value);
    // Changing the nozzle id invalidates whatever we last checked.
    resetCheckState();
  };

  const handleCheckNozzle = async () => {
    const trimmedNozzleId = nozzleId.trim();
    if (!trimmedNozzleId) return;
    setChecking(true);
    setCheckError(null);
    setClosedResult(null);
    try {
      const readings = await listMeterReadings(accessToken);
      // Newest first per the backend contract — the first match for this
      // nozzle that's still open is the current open shift, if any.
      const openShiftMatch =
        readings.find(
          (reading) => reading.nozzleId === trimmedNozzleId && reading.closingReading === null,
        ) ?? null;
      setOpenShiftForNozzle(openShiftMatch);
    } catch (error) {
      const message =
        error instanceof MeterReadingsApiError ? error.message : 'Something went wrong. Please try again.';
      setCheckError(message);
      setOpenShiftForNozzle(undefined);
    } finally {
      setChecking(false);
    }
  };

  const handleOpenShift = async () => {
    const trimmedNozzleId = nozzleId.trim();
    const openingReading = Number(openingReadingInput);
    if (!trimmedNozzleId) return;
    if (!openingReadingInput.trim() || Number.isNaN(openingReading) || openingReading < 0) {
      setOpenError('Enter a valid opening reading (0 or more).');
      return;
    }
    setOpening(true);
    setOpenError(null);
    try {
      const created = await openShift(
        { nozzleId: trimmedNozzleId, staffId: staff.id, openingReading },
        accessToken,
      );
      // Immediately reflect the newly-opened shift so the DSM can close it
      // later in the same session without re-checking.
      setOpenShiftForNozzle(created);
      setOpeningReadingInput('');
    } catch (error) {
      const message =
        error instanceof MeterReadingsApiError ? error.message : 'Something went wrong. Please try again.';
      setOpenError(message);
    } finally {
      setOpening(false);
    }
  };

  const handleCloseShift = async () => {
    if (!openShiftForNozzle) return;
    const closingReading = Number(closingReadingInput);
    if (!closingReadingInput.trim() || Number.isNaN(closingReading) || closingReading < 0) {
      setCloseError('Enter a valid closing reading (0 or more).');
      return;
    }
    // Mirror the server's own rule client-side for immediate feedback — the
    // server remains the real authority (it re-checks this on the request).
    if (closingReading < openShiftForNozzle.openingReading) {
      setCloseError(
        `Closing reading (${closingReading}) cannot be less than opening reading (${openShiftForNozzle.openingReading}).`,
      );
      return;
    }
    setClosing(true);
    setCloseError(null);
    try {
      const closed = await closeShift(openShiftForNozzle.id, closingReading, accessToken);
      setClosedResult(closed);
      setOpenShiftForNozzle(null);
      setClosingReadingInput('');
    } catch (error) {
      const message =
        error instanceof MeterReadingsApiError ? error.message : 'Something went wrong. Please try again.';
      setCloseError(message);
    } finally {
      setClosing(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Meter Reading</Text>

        <Text style={styles.label}>Nozzle ID</Text>
        <TextInput
          style={styles.input}
          value={nozzleId}
          onChangeText={handleNozzleIdChange}
          placeholder="e.g. N1"
          autoCapitalize="characters"
          editable={!checking}
          testID="nozzle-id-input"
        />

        <Pressable
          style={[styles.buttonSecondary, (!nozzleId.trim() || checking) && styles.buttonDisabled]}
          onPress={handleCheckNozzle}
          disabled={!nozzleId.trim() || checking}
          testID="check-nozzle-button"
        >
          {checking ? (
            <ActivityIndicator color="#1a73e8" />
          ) : (
            <Text style={styles.buttonSecondaryText}>Check Nozzle</Text>
          )}
        </Pressable>

        {checkError ? (
          <Text style={styles.error} testID="check-error">
            {checkError}
          </Text>
        ) : null}

        {closedResult ? (
          <View style={styles.resultBox} testID="close-result">
            <Text style={styles.resultTitle}>Shift closed</Text>
            <Text style={styles.resultLine}>Opening reading: {closedResult.openingReading}</Text>
            <Text style={styles.resultLine}>Closing reading: {closedResult.closingReading}</Text>
            <Text style={styles.resultLine}>Litres sold: {closedResult.litresSold}</Text>
          </View>
        ) : null}

        {openShiftForNozzle === undefined ? null : openShiftForNozzle === null ? (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>No open shift for this nozzle</Text>
            <Text style={styles.label}>Opening Reading</Text>
            <TextInput
              style={styles.input}
              value={openingReadingInput}
              onChangeText={setOpeningReadingInput}
              placeholder="e.g. 12345.6"
              keyboardType="decimal-pad"
              editable={!opening}
              testID="opening-reading-input"
            />
            {openError ? (
              <Text style={styles.error} testID="open-error">
                {openError}
              </Text>
            ) : null}
            <Pressable
              style={[styles.button, opening && styles.buttonDisabled]}
              onPress={handleOpenShift}
              disabled={opening}
              testID="open-shift-button"
            >
              {opening ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Open Shift</Text>}
            </Pressable>
          </View>
        ) : (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>Open shift found</Text>
            <Text style={styles.resultLine}>Opening reading: {openShiftForNozzle.openingReading}</Text>
            <Text style={styles.resultLine}>
              Shift start: {new Date(openShiftForNozzle.shiftStart).toLocaleString()}
            </Text>
            <Text style={styles.label}>Closing Reading</Text>
            <TextInput
              style={styles.input}
              value={closingReadingInput}
              onChangeText={setClosingReadingInput}
              placeholder="e.g. 12400.2"
              keyboardType="decimal-pad"
              editable={!closing}
              testID="closing-reading-input"
            />
            {closeError ? (
              <Text style={styles.error} testID="close-error">
                {closeError}
              </Text>
            ) : null}
            <Pressable
              style={[styles.button, closing && styles.buttonDisabled]}
              onPress={handleCloseShift}
              disabled={closing}
              testID="close-shift-button"
            >
              {closing ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Close Shift</Text>}
            </Pressable>
          </View>
        )}

        <Pressable style={styles.backButton} onPress={onBack} testID="meter-reading-back-button">
          <Text style={styles.backButtonText}>Back</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    marginBottom: 24,
    textAlign: 'center',
  },
  label: {
    fontSize: 14,
    color: '#444',
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    marginBottom: 12,
  },
  error: {
    color: '#b00020',
    marginBottom: 12,
  },
  section: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  sectionHeading: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  resultBox: {
    backgroundColor: '#e8f0fe',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  resultTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
    color: '#1a73e8',
  },
  resultLine: {
    fontSize: 14,
    color: '#333',
    marginBottom: 4,
  },
  button: {
    backgroundColor: '#1a73e8',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: {
    backgroundColor: '#9db8e8',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonSecondary: {
    borderWidth: 1,
    borderColor: '#1a73e8',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  buttonSecondaryText: {
    color: '#1a73e8',
    fontSize: 16,
    fontWeight: '600',
  },
  backButton: {
    marginTop: 24,
    alignItems: 'center',
  },
  backButtonText: {
    color: '#1a73e8',
    fontSize: 15,
    fontWeight: '600',
  },
});
