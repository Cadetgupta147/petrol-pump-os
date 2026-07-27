import { useEffect, useMemo, useState } from 'react';
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
  batchClose,
  listMeterReadings,
  MeterReadingsApiError,
  type BatchCloseReadingParams,
  type MeterReading,
} from '../api/meterReadingsApi';
import { getCurrentShiftWindow, ShiftScheduleApiError } from '../api/shiftScheduleApi';
import { listStaff, StaffApiError, type StaffListItem } from '../api/staffApi';

interface Props {
  staff: StaffSummary;
  accessToken: string;
  onBack: () => void;
}

interface RowState {
  openingReading: number;
  closingReadingInput: string;
  meterRolledOver: boolean;
  staffId: string;
}

// Meter Reading redesign (Section 3.3) — replaces the old two-step "pick a
// nozzle, Open Shift, later come back and Close Shift" flow with a single
// batch screen: one row per active nozzle, a closing-reading input
// pre-filled with that nozzle's current opening reading (so an untouched
// row submits "no change" — 0 litres sold — rather than an invalid empty
// value), and ONE submit covering every nozzle at once.
//
// There is no "Open Shift" step anywhere in this screen anymore — opening a
// nozzle's very first shift, and re-opening its next one right after this
// closes it, both happen server-side automatically (see
// MeterReadingsService.batchClose()). Opening reading is still always
// read-only here, exactly like before.
//
// Staff attribution stays PER NOZZLE, not once for the whole screen — see
// batchClose()'s own comment. A DSM caller can only ever attribute
// themselves (resolveAssignableActorId() enforces this server-side
// regardless of what this screen sends), so the per-row staff picker only
// renders for a non-DSM caller (Owner/Accountant/Manager using this app —
// see authApi.ts's note that login here is not actually restricted to DSM).
export function MeterReadingScreen({ staff, accessToken, onBack }: Props) {
  const isDsm = staff.role === 'DSM';

  const [nozzles, setNozzles] = useState<Nozzle[] | null>(null);
  const [staffList, setStaffList] = useState<StaffListItem[]>([]);
  const [currentShiftLabel, setCurrentShiftLabel] = useState<string | null>(null);

  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [initialError, setInitialError] = useState<string | null>(null);

  const [staffPickerForNozzleId, setStaffPickerForNozzleId] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [results, setResults] = useState<MeterReading[] | null>(null);

  function updateRow(nozzleId: string, patch: Partial<RowState>) {
    setRows((prev) => ({ ...prev, [nozzleId]: { ...prev[nozzleId], ...patch } }));
  }

  // Builds each nozzle's row from its current open shift if one exists
  // (openingReading = that shift's own), or its server-computed
  // nextOpeningReading preview otherwise (nozzle never had a shift, or the
  // last one was closed manually via the web portal and nothing has
  // auto-reopened it yet) — same fallback the old screen used.
  function buildRows(nozzleList: Nozzle[], readings: MeterReading[]): Record<string, RowState> {
    const openByNozzle = new Map<string, MeterReading>();
    for (const reading of readings) {
      if (reading.closingReading === null) openByNozzle.set(reading.nozzleId, reading);
    }
    const next: Record<string, RowState> = {};
    for (const nozzle of nozzleList) {
      const open = openByNozzle.get(nozzle.id);
      const openingReading = open ? open.openingReading : nozzle.nextOpeningReading;
      next[nozzle.id] = {
        openingReading,
        closingReadingInput: String(openingReading),
        meterRolledOver: false,
        staffId: staff.id,
      };
    }
    return next;
  }

  useEffect(() => {
    let cancelled = false;

    Promise.all([listNozzles(accessToken), listMeterReadings(accessToken)])
      .then(([nozzleList, readings]) => {
        if (cancelled) return;
        setNozzles(nozzleList);
        setRows(buildRows(nozzleList, readings));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message =
          error instanceof NozzlesApiError || error instanceof MeterReadingsApiError
            ? error.message
            : 'Something went wrong. Please try again.';
        setInitialError(message);
      })
      .finally(() => {
        if (!cancelled) setLoadingInitial(false);
      });

    // Both of these are advisory-only — a failure here must never block the
    // screen, so failures are swallowed rather than surfaced as a blocking
    // error (see getCurrentShiftWindow()'s and this screen's own comments).
    getCurrentShiftWindow(accessToken)
      .then((window) => {
        if (cancelled) return;
        setCurrentShiftLabel(
          window ? `${window.shiftDefinition.label} (${window.shiftDefinition.startTime}–${window.shiftDefinition.endTime})` : null,
        );
      })
      .catch(() => undefined);

    if (!isDsm) {
      listStaff(accessToken)
        .then((result) => {
          if (!cancelled) setStaffList(result);
        })
        .catch(() => undefined);
    }

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  const canSubmit = useMemo(() => {
    if (!nozzles || nozzles.length === 0 || submitting) return false;
    return nozzles.every((nozzle) => {
      const row = rows[nozzle.id];
      if (!row) return false;
      const value = Number(row.closingReadingInput);
      return row.closingReadingInput.trim().length > 0 && !Number.isNaN(value) && value >= 0;
    });
  }, [nozzles, rows, submitting]);

  async function handleSubmit() {
    if (!nozzles) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      const readings: BatchCloseReadingParams[] = nozzles.map((nozzle) => {
        const row = rows[nozzle.id];
        return {
          nozzleId: nozzle.id,
          closingReading: Number(row.closingReadingInput),
          ...(row.meterRolledOver && { meterRolledOver: true }),
          ...(row.staffId !== staff.id && { staffId: row.staffId }),
        };
      });
      const updated = await batchClose(readings, accessToken);
      setResults(updated);

      // Reload so the next round's opening readings reflect the shifts that
      // were just auto-reopened server-side.
      const readingsAfter = await listMeterReadings(accessToken);
      setRows(buildRows(nozzles, readingsAfter));
    } catch (error) {
      const message =
        error instanceof MeterReadingsApiError || error instanceof ShiftScheduleApiError || error instanceof StaffApiError
          ? error.message
          : 'Something went wrong. Please try again.';
      setSubmitError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Meter Reading</Text>
        {currentShiftLabel ? (
          <Text style={styles.shiftLabel} testID="current-shift-label">
            Now closing: {currentShiftLabel}
          </Text>
        ) : null}

        {initialError ? (
          <Text style={styles.error} testID="initial-error">
            {initialError}
          </Text>
        ) : loadingInitial ? (
          <ActivityIndicator style={{ marginBottom: 16 }} />
        ) : nozzles && nozzles.length === 0 ? (
          <Text style={styles.error}>
            No nozzles are configured yet — ask the owner/accountant to add this pump&rsquo;s nozzles under
            Settings on the web portal.
          </Text>
        ) : (
          nozzles?.map((nozzle) => {
            const row = rows[nozzle.id];
            if (!row) return null;
            const staffName = staffList.find((s) => s.id === row.staffId)?.name ?? staff.name;
            return (
              <View key={nozzle.id} style={styles.row} testID={`nozzle-row-${nozzle.label}`}>
                <Text style={styles.rowLabel}>
                  {nozzle.label} &middot; {nozzle.item.name}
                </Text>
                <Text style={styles.hint}>Opening reading (not editable): {row.openingReading.toFixed(1)}</Text>

                <Text style={styles.label}>Closing reading</Text>
                <TextInput
                  style={styles.input}
                  value={row.closingReadingInput}
                  onChangeText={(text) => updateRow(nozzle.id, { closingReadingInput: text })}
                  keyboardType="decimal-pad"
                  editable={!submitting}
                  testID={`closing-input-${nozzle.label}`}
                />

                {nozzle.rolloverAt != null && (
                  <Pressable
                    style={styles.checkboxRow}
                    onPress={() => updateRow(nozzle.id, { meterRolledOver: !row.meterRolledOver })}
                    testID={`rollover-toggle-${nozzle.label}`}
                  >
                    <View style={[styles.checkbox, row.meterRolledOver && styles.checkboxChecked]}>
                      {row.meterRolledOver ? <Text style={styles.checkboxMark}>✓</Text> : null}
                    </View>
                    <Text style={styles.checkboxLabel}>
                      Meter rolled over this shift (rollover point: {nozzle.rolloverAt.toFixed(2)})
                    </Text>
                  </Pressable>
                )}

                {isDsm ? (
                  <Text style={styles.hint}>Staff: {staff.name}</Text>
                ) : (
                  <Pressable
                    style={styles.staffPicker}
                    onPress={() => setStaffPickerForNozzleId(nozzle.id)}
                    testID={`staff-picker-${nozzle.label}`}
                  >
                    <Text style={styles.staffPickerText}>Staff: {staffName}</Text>
                  </Pressable>
                )}
              </View>
            );
          })
        )}

        {submitError ? (
          <Text style={styles.error} testID="submit-error">
            {submitError}
          </Text>
        ) : null}

        {results ? (
          <View style={styles.resultBox} testID="batch-results">
            <Text style={styles.resultTitle}>Closed {results.length} nozzle{results.length === 1 ? '' : 's'}</Text>
            {results.map((reading) => (
              <Text key={reading.id} style={styles.resultLine}>
                {reading.nozzle.label}: {reading.litresSold} L
                {reading.tankWarning ? ` — ${reading.tankWarning}` : ''}
              </Text>
            ))}
          </View>
        ) : null}

        {/* Section [new] — the SAME string on every reading in the response
            (only ever set on the first close of the day, see
            MeterReadingsService.buildRateReminder()), so grabbing it off the
            first result is enough — one banner, not one per nozzle. */}
        {results?.[0]?.rateReminder ? (
          <View style={styles.warningBanner} testID="rate-reminder-banner">
            <Text style={styles.warningBannerText}>{results[0].rateReminder}</Text>
          </View>
        ) : null}

        {nozzles && nozzles.length > 0 && (
          <Pressable
            style={[styles.button, !canSubmit && styles.buttonDisabled]}
            onPress={() => {
              void handleSubmit();
            }}
            disabled={!canSubmit}
            testID="submit-batch-button"
          >
            {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Submit closing readings</Text>}
          </Pressable>
        )}

        <Pressable style={styles.backButton} onPress={onBack} testID="meter-reading-back-button">
          <Text style={styles.backButtonText}>Back</Text>
        </Pressable>
      </ScrollView>

      <Modal
        visible={staffPickerForNozzleId !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setStaffPickerForNozzleId(null)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setStaffPickerForNozzleId(null)}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Select staff</Text>
            <FlatList
              data={staffList}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.modalOption}
                  onPress={() => {
                    if (staffPickerForNozzleId) updateRow(staffPickerForNozzleId, { staffId: item.id });
                    setStaffPickerForNozzleId(null);
                  }}
                  testID={`staff-option-${item.name}`}
                >
                  <Text style={styles.modalOptionText}>{item.name}</Text>
                </Pressable>
              )}
            />
          </View>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  warningBanner: {
    marginBottom: 16,
    backgroundColor: '#fff8e1',
    borderWidth: 1,
    borderColor: '#f0c36d',
    borderRadius: 8,
    padding: 12,
  },
  warningBannerText: {
    fontSize: 13,
    color: '#7a5b00',
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  shiftLabel: {
    fontSize: 13,
    color: '#555',
    textAlign: 'center',
    marginBottom: 20,
  },
  label: {
    fontSize: 13,
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
    marginBottom: 10,
  },
  error: {
    color: '#b00020',
    marginBottom: 12,
  },
  row: {
    marginBottom: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  rowLabel: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  hint: {
    fontSize: 12,
    color: '#777',
    marginBottom: 10,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
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
  staffPicker: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignSelf: 'flex-start',
  },
  staffPickerText: {
    fontSize: 13,
    color: '#111',
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
    marginBottom: 16,
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
  },
  backButtonText: {
    color: '#1a73e8',
    fontSize: 15,
    fontWeight: '600',
  },
});
