import { useEffect, useMemo, useState } from 'react';
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
import { listMeterReadings, MeterReadingsApiError, type MeterReading } from '../api/meterReadingsApi';
import {
  createShiftSalesSummary,
  listShiftSalesSummaries,
  updateShiftSalesSummary,
  ShiftSalesApiError,
  type ShiftSalesSummary,
} from '../api/shiftSalesApi';
import { getUpiCaptureConfig, UpiCaptureConfigApiError } from '../api/upiCaptureConfigApi';

interface Props {
  staff: StaffSummary;
  accessToken: string;
  onBack: () => void;
}

interface RowFormState {
  cashInput: string;
  cardInput: string;
  upiInput: string;
}

// Section 8A.2/8A.3 — walk-in (non-itemized) sales capture. Every closed
// shift needs cash/card totals entered by hand (there is no automation for
// either — Section 8A.3 explains why card can't be, and cash never can be).
// UPI is the one field whose editability depends on this pump's
// UpiCaptureConfig: while a dealer hasn't handed over their PhonePe/Paytm
// webhook (autoCaptureEnabled=false, the default), UPI is entered manually
// right alongside cash/card; once a dealer wires up the webhook, this
// screen switches that field to read-only and shows whatever the webhook
// has captured so far — see ShiftSalesService.assertManualUpiAllowed(),
// which is the actual server-side enforcement this UI mirrors.
//
// Bounded to the most recent CLOSED_SHIFT_LIMIT shifts (closingReading set)
// — a DSM only ever sees their own (server also only lets a DSM attribute
// themselves — see meter-readings' resolveAssignableActorId()), everyone
// else sees all, same split MeterReadingScreen uses for the staff picker.
const CLOSED_SHIFT_LIMIT = 30;

export function ShiftSalesSummaryScreen({ staff, accessToken, onBack }: Props) {
  const isDsm = staff.role === 'DSM';

  const [closedShifts, setClosedShifts] = useState<MeterReading[] | null>(null);
  const [summariesByShiftId, setSummariesByShiftId] = useState<Record<string, ShiftSalesSummary>>({});
  const [autoCaptureEnabled, setAutoCaptureEnabled] = useState(false);

  const [loadingInitial, setLoadingInitial] = useState(true);
  const [initialError, setInitialError] = useState<string | null>(null);

  const [expandedShiftId, setExpandedShiftId] = useState<string | null>(null);
  const [rowForms, setRowForms] = useState<Record<string, RowFormState>>({});
  const [submittingShiftId, setSubmittingShiftId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  async function loadAll() {
    setInitialError(null);
    setLoadingInitial(true);
    try {
      const [readings, summaries, upiConfig] = await Promise.all([
        listMeterReadings(accessToken),
        listShiftSalesSummaries(accessToken),
        getUpiCaptureConfig(accessToken),
      ]);

      const closed = readings
        .filter((r) => r.closingReading !== null && r.shiftEnd !== null)
        .filter((r) => !isDsm || r.staffId === staff.id)
        .sort((a, b) => new Date(b.shiftEnd!).getTime() - new Date(a.shiftEnd!).getTime())
        .slice(0, CLOSED_SHIFT_LIMIT);

      setClosedShifts(closed);
      setSummariesByShiftId(Object.fromEntries(summaries.map((s) => [s.shiftId, s])));
      setAutoCaptureEnabled(upiConfig.autoCaptureEnabled);
    } catch (error) {
      const message =
        error instanceof MeterReadingsApiError ||
        error instanceof ShiftSalesApiError ||
        error instanceof UpiCaptureConfigApiError
          ? error.message
          : 'Something went wrong. Please try again.';
      setInitialError(message);
    } finally {
      setLoadingInitial(false);
    }
  }

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  function openRow(shiftId: string) {
    const existing = summariesByShiftId[shiftId];
    setRowForms((prev) => ({
      ...prev,
      [shiftId]: {
        cashInput: String(existing?.walkInCashCollected ?? 0),
        cardInput: String(existing?.walkInCardCollected ?? 0),
        upiInput: String(existing?.walkInUpiCollected ?? 0),
      },
    }));
    setRowErrors((prev) => ({ ...prev, [shiftId]: '' }));
    setExpandedShiftId(shiftId);
  }

  function updateRowForm(shiftId: string, patch: Partial<RowFormState>) {
    setRowForms((prev) => ({ ...prev, [shiftId]: { ...prev[shiftId], ...patch } }));
  }

  function canSubmitRow(shiftId: string): boolean {
    const form = rowForms[shiftId];
    if (!form || submittingShiftId === shiftId) return false;
    const cash = Number(form.cashInput);
    const card = Number(form.cardInput);
    if (form.cashInput.trim().length === 0 || Number.isNaN(cash) || cash < 0) return false;
    if (form.cardInput.trim().length === 0 || Number.isNaN(card) || card < 0) return false;
    if (!autoCaptureEnabled) {
      const upi = Number(form.upiInput);
      if (form.upiInput.trim().length === 0 || Number.isNaN(upi) || upi < 0) return false;
    }
    return true;
  }

  async function submitRow(shiftId: string) {
    const form = rowForms[shiftId];
    if (!form) return;
    setSubmittingShiftId(shiftId);
    setRowErrors((prev) => ({ ...prev, [shiftId]: '' }));
    try {
      const params = {
        walkInCashCollected: Number(form.cashInput),
        walkInCardCollected: Number(form.cardInput),
        // Omitted entirely (not sent as 0) while auto-capture is on — the
        // server rejects a client-supplied walkInUpiCollected in that case
        // (ShiftSalesService.assertManualUpiAllowed), so this field must be
        // left out rather than sent as "no change".
        ...(!autoCaptureEnabled && { walkInUpiCollected: Number(form.upiInput) }),
      };

      const existing = summariesByShiftId[shiftId];
      const saved = existing
        ? await updateShiftSalesSummary(existing.id, params, accessToken)
        : await createShiftSalesSummary({ shiftId, ...params }, accessToken);

      setSummariesByShiftId((prev) => ({ ...prev, [shiftId]: saved }));
      setExpandedShiftId(null);
    } catch (error) {
      const message =
        error instanceof ShiftSalesApiError ? error.message : 'Something went wrong. Please try again.';
      setRowErrors((prev) => ({ ...prev, [shiftId]: message }));
    } finally {
      setSubmittingShiftId(null);
    }
  }

  const upiHint = useMemo(
    () =>
      autoCaptureEnabled
        ? 'UPI is auto-captured from the PhonePe/Paytm webhook for this pump.'
        : 'UPI auto-capture is off for this pump — enter it by hand, same as cash/card.',
    [autoCaptureEnabled],
  );

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Shift Sales Summary</Text>
        <Text style={styles.hint}>{upiHint}</Text>

        {initialError ? (
          <Text style={styles.error} testID="initial-error">
            {initialError}
          </Text>
        ) : loadingInitial ? (
          <ActivityIndicator style={{ marginBottom: 16 }} />
        ) : closedShifts && closedShifts.length === 0 ? (
          <Text style={styles.error}>
            No closed shifts yet — close a nozzle&rsquo;s meter reading first (Meter Reading screen).
          </Text>
        ) : (
          closedShifts?.map((reading) => {
            const summary = summariesByShiftId[reading.id];
            const isExpanded = expandedShiftId === reading.id;
            const form = rowForms[reading.id];
            const rowError = rowErrors[reading.id];

            return (
              <View key={reading.id} style={styles.row} testID={`shift-row-${reading.nozzle.label}`}>
                <Text style={styles.rowLabel}>
                  {reading.nozzle.label} &middot; {reading.nozzle.item.name}
                </Text>
                <Text style={styles.hint}>
                  {new Date(reading.shiftStart).toLocaleString()} &rarr;{' '}
                  {reading.shiftEnd ? new Date(reading.shiftEnd).toLocaleString() : ''}
                </Text>
                <Text style={styles.hint}>Litres sold: {reading.litresSold?.toFixed(2) ?? '—'}</Text>

                {summary ? (
                  <View style={styles.summaryBox}>
                    <Text style={styles.summaryLine}>
                      Cash ₹{summary.walkInCashCollected} &middot; Card ₹{summary.walkInCardCollected} &middot; UPI ₹
                      {summary.walkInUpiCollected}
                    </Text>
                    <Text
                      style={[styles.summaryLine, summary.variance !== 0 && styles.varianceWarning]}
                      testID={`variance-${reading.nozzle.label}`}
                    >
                      Expected ₹{summary.expectedValue} &middot; Variance ₹{summary.variance}
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.needsTotals}>Needs shift totals</Text>
                )}

                {!isExpanded && (
                  <Pressable
                    style={styles.smallButton}
                    onPress={() => openRow(reading.id)}
                    testID={`enter-totals-${reading.nozzle.label}`}
                  >
                    <Text style={styles.smallButtonText}>{summary ? 'Edit totals' : 'Enter totals'}</Text>
                  </Pressable>
                )}

                {isExpanded && form && (
                  <View style={styles.form}>
                    <Text style={styles.label}>Cash collected</Text>
                    <TextInput
                      style={styles.input}
                      value={form.cashInput}
                      onChangeText={(text) => updateRowForm(reading.id, { cashInput: text })}
                      keyboardType="decimal-pad"
                      editable={submittingShiftId !== reading.id}
                      testID={`cash-input-${reading.nozzle.label}`}
                    />

                    <Text style={styles.label}>Card collected</Text>
                    <TextInput
                      style={styles.input}
                      value={form.cardInput}
                      onChangeText={(text) => updateRowForm(reading.id, { cardInput: text })}
                      keyboardType="decimal-pad"
                      editable={submittingShiftId !== reading.id}
                      testID={`card-input-${reading.nozzle.label}`}
                    />

                    <Text style={styles.label}>UPI collected</Text>
                    {autoCaptureEnabled ? (
                      <Text style={styles.autoCapturedValue} testID={`upi-readonly-${reading.nozzle.label}`}>
                        ₹{summary?.walkInUpiCollected ?? 0} (auto-captured — not editable here)
                      </Text>
                    ) : (
                      <TextInput
                        style={styles.input}
                        value={form.upiInput}
                        onChangeText={(text) => updateRowForm(reading.id, { upiInput: text })}
                        keyboardType="decimal-pad"
                        editable={submittingShiftId !== reading.id}
                        testID={`upi-input-${reading.nozzle.label}`}
                      />
                    )}

                    {rowError ? (
                      <Text style={styles.error} testID={`row-error-${reading.nozzle.label}`}>
                        {rowError}
                      </Text>
                    ) : null}

                    <View style={styles.formButtons}>
                      <Pressable
                        style={styles.cancelButton}
                        onPress={() => setExpandedShiftId(null)}
                        disabled={submittingShiftId === reading.id}
                        testID={`cancel-${reading.nozzle.label}`}
                      >
                        <Text style={styles.cancelButtonText}>Cancel</Text>
                      </Pressable>
                      <Pressable
                        style={[styles.button, !canSubmitRow(reading.id) && styles.buttonDisabled]}
                        onPress={() => {
                          void submitRow(reading.id);
                        }}
                        disabled={!canSubmitRow(reading.id)}
                        testID={`submit-totals-${reading.nozzle.label}`}
                      >
                        {submittingShiftId === reading.id ? (
                          <ActivityIndicator color="#fff" />
                        ) : (
                          <Text style={styles.buttonText}>Save</Text>
                        )}
                      </Pressable>
                    </View>
                  </View>
                )}
              </View>
            );
          })
        )}

        <Pressable style={styles.backButton} onPress={onBack} testID="shift-sales-back-button">
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
    marginBottom: 8,
    textAlign: 'center',
  },
  hint: {
    fontSize: 12,
    color: '#777',
    marginBottom: 10,
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
  summaryBox: {
    backgroundColor: '#f4f4f4',
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
  },
  summaryLine: {
    fontSize: 13,
    color: '#333',
  },
  varianceWarning: {
    color: '#b00020',
    fontWeight: '600',
  },
  needsTotals: {
    fontSize: 13,
    color: '#b06f00',
    fontWeight: '600',
    marginBottom: 10,
  },
  smallButton: {
    borderWidth: 1,
    borderColor: '#1a73e8',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    alignSelf: 'flex-start',
  },
  smallButtonText: {
    color: '#1a73e8',
    fontSize: 13,
    fontWeight: '600',
  },
  form: {
    marginTop: 6,
  },
  autoCapturedValue: {
    fontSize: 15,
    color: '#333',
    backgroundColor: '#f4f4f4',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  formButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 12,
  },
  cancelButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  cancelButtonText: {
    color: '#555',
    fontSize: 15,
    fontWeight: '600',
  },
  button: {
    backgroundColor: '#1a73e8',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  buttonDisabled: {
    backgroundColor: '#9db8e8',
  },
  buttonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  backButton: {
    alignItems: 'center',
    marginTop: 8,
  },
  backButtonText: {
    color: '#1a73e8',
    fontSize: 15,
    fontWeight: '600',
  },
});
