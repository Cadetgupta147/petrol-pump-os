import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { StaffSummary } from '../api/authApi';
import { listNozzles, NozzlesApiError, type Nozzle } from '../api/nozzlesApi';
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
// Section 3.3/4 Nozzle master rework: nozzleId is now picked from a real
// dropdown (GET /nozzles, dealer-configured under Settings on the web
// portal) instead of a free-typed field — a DSM can no longer mistype a
// nozzle id. Picking a nozzle immediately checks for an open shift on it
// (no separate "Check Nozzle" button anymore — see handleSelectNozzle()).
// Opening reading is NEVER a form field here: it's shown read-only
// (nozzle.nextOpeningReading, the carry-forward rule's result — this
// nozzle's last closed shift's closingReading, or its configured
// startingReading if it's never had one) and the backend derives the real
// value itself when the shift is actually opened.
export function MeterReadingScreen({ staff, accessToken, onBack }: Props) {
  const [nozzles, setNozzles] = useState<Nozzle[] | null>(null);
  const [nozzlesError, setNozzlesError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedNozzleId, setSelectedNozzleId] = useState<string | null>(null);

  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  // undefined = not checked yet; null = checked, no open shift found;
  // MeterReading = checked, open shift found.
  const [openShiftForNozzle, setOpenShiftForNozzle] = useState<MeterReading | null | undefined>(
    undefined,
  );

  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  const [closingReadingInput, setClosingReadingInput] = useState('');
  const [meterRolledOver, setMeterRolledOver] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [closedResult, setClosedResult] = useState<MeterReading | null>(null);

  useEffect(() => {
    let cancelled = false;
    listNozzles(accessToken)
      .then((result) => {
        if (!cancelled) setNozzles(result);
      })
      .catch((error) => {
        if (cancelled) return;
        setNozzlesError(
          error instanceof NozzlesApiError ? error.message : 'Something went wrong. Please try again.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const selectedNozzle = nozzles?.find((n) => n.id === selectedNozzleId) ?? null;

  async function handleSelectNozzle(nozzle: Nozzle) {
    setPickerOpen(false);
    setSelectedNozzleId(nozzle.id);
    setOpenShiftForNozzle(undefined);
    setCheckError(null);
    setOpenError(null);
    setCloseError(null);
    setClosedResult(null);
    setClosingReadingInput('');
    setMeterRolledOver(false);

    setChecking(true);
    try {
      const readings = await listMeterReadings(accessToken);
      // Newest first per the backend contract — the first match for this
      // nozzle that's still open is the current open shift, if any.
      const openShiftMatch =
        readings.find((reading) => reading.nozzleId === nozzle.id && reading.closingReading === null) ??
        null;
      setOpenShiftForNozzle(openShiftMatch);
    } catch (error) {
      const message =
        error instanceof MeterReadingsApiError ? error.message : 'Something went wrong. Please try again.';
      setCheckError(message);
      setOpenShiftForNozzle(undefined);
    } finally {
      setChecking(false);
    }
  }

  const handleOpenShift = async () => {
    if (!selectedNozzleId) return;
    setOpening(true);
    setOpenError(null);
    try {
      const created = await openShift({ nozzleId: selectedNozzleId, staffId: staff.id }, accessToken);
      // Immediately reflect the newly-opened shift so the DSM can close it
      // later in the same session without re-checking.
      setOpenShiftForNozzle(created);
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
    // Skipped when meterRolledOver is checked — a lower closing reading is
    // exactly what a physical meter rollover looks like.
    if (!meterRolledOver && closingReading < openShiftForNozzle.openingReading) {
      setCloseError(
        `Closing reading (${closingReading}) cannot be less than opening reading (${openShiftForNozzle.openingReading}). If this nozzle's meter physically rolled over to zero, check "meter rolled over" below.`,
      );
      return;
    }
    setClosing(true);
    setCloseError(null);
    try {
      const closed = await closeShift(openShiftForNozzle.id, closingReading, accessToken, meterRolledOver);
      setClosedResult(closed);
      setOpenShiftForNozzle(null);
      setClosingReadingInput('');
      setMeterRolledOver(false);
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

        <Text style={styles.label}>Nozzle</Text>
        {nozzlesError ? (
          <Text style={styles.error} testID="nozzles-error">
            {nozzlesError}
          </Text>
        ) : !nozzles ? (
          <ActivityIndicator style={{ marginBottom: 12 }} />
        ) : nozzles.length === 0 ? (
          <Text style={styles.error}>
            No nozzles are configured yet — ask the owner/accountant to add this pump&rsquo;s nozzles under
            Settings on the web portal.
          </Text>
        ) : (
          <Pressable
            style={styles.picker}
            onPress={() => setPickerOpen(true)}
            testID="nozzle-picker-button"
          >
            <Text style={selectedNozzle ? styles.pickerValue : styles.pickerPlaceholder}>
              {selectedNozzle ? `${selectedNozzle.label} · ${selectedNozzle.item.name}` : 'Select nozzle'}
            </Text>
          </Pressable>
        )}

        <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
          <Pressable style={styles.modalOverlay} onPress={() => setPickerOpen(false)}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Select nozzle</Text>
              <FlatList
                data={nozzles ?? []}
                keyExtractor={(nozzle) => nozzle.id}
                renderItem={({ item: nozzle }) => (
                  <Pressable
                    style={styles.modalOption}
                    onPress={() => {
                      void handleSelectNozzle(nozzle);
                    }}
                    testID={`nozzle-option-${nozzle.label}`}
                  >
                    <Text style={styles.modalOptionText}>
                      {nozzle.label} · {nozzle.item.name}
                    </Text>
                  </Pressable>
                )}
              />
            </View>
          </Pressable>
        </Modal>

        {checking ? <ActivityIndicator style={{ marginVertical: 12 }} color="#1a73e8" /> : null}

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

        {!checking && openShiftForNozzle === undefined
          ? null
          : !checking && openShiftForNozzle === null && selectedNozzle ? (
              <View style={styles.section}>
                <Text style={styles.sectionHeading}>No open shift for this nozzle</Text>
                <Text style={styles.resultLine}>
                  Opening reading (carried forward — not editable): {selectedNozzle.nextOpeningReading.toFixed(1)}
                </Text>
                <Text style={styles.hint}>
                  This is the previous shift&rsquo;s closing reading, or this nozzle&rsquo;s configured starting
                  reading if it&rsquo;s never had a shift.
                </Text>
                {openError ? (
                  <Text style={styles.error} testID="open-error">
                    {openError}
                  </Text>
                ) : null}
                <Pressable
                  style={[styles.button, opening && styles.buttonDisabled]}
                  onPress={() => {
                    void handleOpenShift();
                  }}
                  disabled={opening}
                  testID="open-shift-button"
                >
                  {opening ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Open Shift</Text>}
                </Pressable>
              </View>
            ) : !checking && openShiftForNozzle ? (
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
                {openShiftForNozzle.nozzle.rolloverAt != null && (
                  <Pressable
                    style={styles.checkboxRow}
                    onPress={() => setMeterRolledOver((prev) => !prev)}
                    testID="meter-rolled-over-toggle"
                  >
                    <View style={[styles.checkbox, meterRolledOver && styles.checkboxChecked]}>
                      {meterRolledOver ? <Text style={styles.checkboxMark}>✓</Text> : null}
                    </View>
                    <Text style={styles.checkboxLabel}>
                      This meter physically rolled over to zero this shift (rollover point:{' '}
                      {openShiftForNozzle.nozzle.rolloverAt.toFixed(2)})
                    </Text>
                  </Pressable>
                )}
                {closeError ? (
                  <Text style={styles.error} testID="close-error">
                    {closeError}
                  </Text>
                ) : null}
                <Pressable
                  style={[styles.button, closing && styles.buttonDisabled]}
                  onPress={() => {
                    void handleCloseShift();
                  }}
                  disabled={closing}
                  testID="close-shift-button"
                >
                  {closing ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Close Shift</Text>}
                </Pressable>
              </View>
            ) : null}

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
  picker: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 14,
    marginBottom: 12,
  },
  pickerPlaceholder: {
    fontSize: 16,
    color: '#999',
  },
  pickerValue: {
    fontSize: 16,
    color: '#111',
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    maxHeight: '60%',
    paddingVertical: 8,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  modalOption: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  modalOptionText: {
    fontSize: 16,
  },
  error: {
    color: '#b00020',
    marginBottom: 12,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#1a73e8',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  checkboxChecked: {
    backgroundColor: '#1a73e8',
  },
  checkboxMark: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  checkboxLabel: {
    flex: 1,
    fontSize: 13,
    color: '#333',
  },
  hint: {
    fontSize: 12,
    color: '#777',
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
