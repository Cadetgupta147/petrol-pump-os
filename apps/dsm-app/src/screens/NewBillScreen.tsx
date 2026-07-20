import { useEffect, useRef, useState } from 'react';
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
  createBill,
  BillsApiError,
  type Bill,
  type BillPaymentLineInput,
  type QuickAddCustomerInput,
} from '../api/billsApi';
import type { CustomerLookup, CustomerSummary } from '../api/customersApi';
import { calculatePointsPreview, type PointsPreview } from '../api/loyaltyApi';
import { generateAndSaveReceiptPdf, ReceiptError, shareReceiptPdf, type SavedReceipt } from '../receipts/billReceipt';
import { AddPaymentModal } from './AddPaymentModal';
import { CreditCustomerPicker } from './CreditCustomerPicker';
import { hasCreditCustomerConflict } from './creditCustomerConflict';
import { ScanCustomerModal } from './ScanCustomerModal';

interface Props {
  staff: StaffSummary;
  accessToken: string;
  onBack: () => void;
}

const EPSILON = 0.01;

// There is no product-type / Tank master endpoint yet (per task spec) — a
// small fixed picker stands in for it. Simplifying assumption, not a real
// product master; revisit once Section 7's Tank model is wired up.
const PRODUCT_TYPES = ['PETROL', 'DIESEL', 'PREMIUM'] as const;
type ProductType = (typeof PRODUCT_TYPES)[number];

interface LocalPaymentLine extends BillPaymentLineInput {
  localId: string;
}

let localIdCounter = 0;
function makeLocalId(): string {
  localIdCounter += 1;
  return `line-${Date.now()}-${localIdCounter}`;
}

// Section 4 (New Bill screen, vehicle/customer-name validation) + Section 5A
// (full split-payment "Add Payment" flow) + Section 6.3 (QR-scan customer
// identification: scan/type a member ID, auto-fill name + vehicle, live
// loyalty points preview before Save — per the Section 14 mockup, Scan QR is
// the primary action at the top and the text fields below are the walk-in
// fallback path).
//
// Debounce for the points preview call — fires once typing pauses, not on
// every keystroke.
const POINTS_PREVIEW_DEBOUNCE_MS = 450;
export function NewBillScreen({ staff, accessToken, onBack }: Props) {
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [amountInput, setAmountInput] = useState('');
  const [litresInput, setLitresInput] = useState('');
  const [rateAppliedInput, setRateAppliedInput] = useState('');
  const [productType, setProductType] = useState<ProductType>('PETROL');

  const [lines, setLines] = useState<LocalPaymentLine[]>([]);

  // Only one of these two should ever be set at a time — mirrors the
  // backend's customerId/quickAddCustomer mutual exclusivity (Section 3.4A).
  const [creditCustomerId, setCreditCustomerId] = useState<string | undefined>(undefined);
  const [creditQuickAdd, setCreditQuickAdd] = useState<QuickAddCustomerInput | undefined>(undefined);
  const [creditCustomerLabel, setCreditCustomerLabel] = useState<string | undefined>(undefined);

  // Section 6.3 — the customer resolved from a scanned/hand-typed member ID.
  // Kept separate from the credit-picker pair above: a scanned customer
  // stays attached to a pure cash/UPI bill too (that's how they earn
  // points), while creditCustomerId/creditQuickAdd only exist while a
  // CREDIT line does.
  const [scannedCustomer, setScannedCustomer] = useState<CustomerLookup | null>(null);
  const [scanVisible, setScanVisible] = useState(false);

  // Live points preview (Section 6.3 step 4 / Section 14 mockup banner).
  // Strictly non-blocking: null means "nothing to show" (no customer, zero
  // bill, loyalty unconfigured, or the preview call failed) — never an
  // error state on the bill form.
  const [pointsPreview, setPointsPreview] = useState<PointsPreview | null>(null);
  const previewRequestRef = useRef(0);

  const [addPaymentVisible, setAddPaymentVisible] = useState(false);
  const [creditPickerVisible, setCreditPickerVisible] = useState(false);
  const creditResolveRef = useRef<((resolved: boolean) => void) | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successBill, setSuccessBill] = useState<Bill | null>(null);

  // Set when a QR scan resolves to a customer who is NOT the one already
  // attached to an existing CREDIT payment line — see handleCustomerResolved.
  // Blocking, inline error (mirrors submitError below), not a toast: the scan
  // must not silently reattribute a CREDIT line's money to a different
  // customer (the bug this guards against — Section 3.4A / Section 4).
  const [scanConflictError, setScanConflictError] = useState<string | null>(null);

  const [savingReceipt, setSavingReceipt] = useState(false);
  const [savedReceipt, setSavedReceipt] = useState<SavedReceipt | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [sharingReceipt, setSharingReceipt] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  const amount = Number(amountInput) || 0;
  const litres = Number(litresInput) || 0;
  const rateApplied = Number(rateAppliedInput) || 0;

  const sumIn = lines.filter((line) => line.direction === 'IN').reduce((total, line) => total + line.amount, 0);
  const sumOut = lines.filter((line) => line.direction === 'OUT').reduce((total, line) => total + line.amount, 0);
  // Section 5A.3 — the live "Remaining to collect" ticker.
  const remaining = amount - (sumIn - sumOut);
  const balanced = Math.abs(remaining) <= EPSILON;

  const hasVehicleOrName = vehicleNumber.trim().length > 0 || customerName.trim().length > 0;

  // One customerId slot per bill (see bills.service.ts): a scanned customer
  // takes it; otherwise the credit picker's choice does. Scanning clears the
  // picker state (handleCustomerResolved), so the two never coexist.
  const effectiveCustomerId = scannedCustomer?.customerId ?? creditCustomerId;
  const hasCreditCustomer = !!effectiveCustomerId || !!creditQuickAdd;

  // Only reachable by scanning a customer, adding a CREDIT line (which skips
  // the picker because hasCreditCustomer is true), then removing the scanned
  // customer — the CREDIT line would be left with nobody to owe it.
  const hasCreditLine = lines.some((line) => line.paymentType === 'CREDIT');
  const creditLineNeedsCustomer = hasCreditLine && !hasCreditCustomer;

  const canSave =
    !submitting &&
    hasVehicleOrName &&
    amount > 0 &&
    litres > 0 &&
    rateApplied > 0 &&
    lines.length > 0 &&
    balanced &&
    !creditLineNeedsCustomer;

  // Small "what's missing" hint below Save — the button being merely
  // disabled doesn't tell the DSM *why*, especially for the numeric fields
  // where an empty/invalid entry silently evaluates to 0.
  const missingReasons: string[] = [];
  if (!hasVehicleOrName) missingReasons.push('vehicle number or customer name');
  if (!(amount > 0)) missingReasons.push('a valid amount');
  if (!(litres > 0)) missingReasons.push('valid litres');
  if (!(rateApplied > 0)) missingReasons.push('a valid rate applied');
  if (lines.length === 0) missingReasons.push('at least one payment');
  else if (!balanced) missingReasons.push('payments that add up to the full amount');
  if (creditLineNeedsCustomer) missingReasons.push('a customer for the CREDIT payment');

  // Section 6.3 step 4 — fetch the points preview as amount/litres are
  // entered, debounced so it fires when typing pauses rather than on every
  // keystroke. The request counter discards stale responses (a slow reply
  // for ₹100 must not overwrite the banner for ₹1000 typed since).
  // pointsPreview holds only the last successfully fetched preview — it is
  // never cleared from inside this effect. Whether it's currently relevant
  // to show is computed at render time from the current inputs (see the
  // banner's render gate below), not stored as a second copy of "should I
  // show nothing" state here.
  const scannedCustomerId = scannedCustomer?.customerId;
  useEffect(() => {
    previewRequestRef.current += 1;
    const requestId = previewRequestRef.current;

    if (!scannedCustomerId || (amount <= 0 && litres <= 0)) {
      return;
    }

    const timer = setTimeout(() => {
      calculatePointsPreview({ amount, litres, customerId: scannedCustomerId }, accessToken)
        .then((preview) => {
          if (previewRequestRef.current === requestId) setPointsPreview(preview);
        })
        .catch(() => {
          // Non-blocking by design — a failed fetch just leaves the last
          // successful preview (if any) as-is; the authoritative calculation
          // happens server-side at save regardless.
        });
    }, POINTS_PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [scannedCustomerId, amount, litres, accessToken]);

  // Section 6.3 steps 2–3 — a member ID resolved (scan or manual fallback):
  // attach the customer and auto-fill name + vehicle number. The scanned
  // customer replaces any credit-picker choice — one customerId slot per
  // bill — so any CREDIT lines now belong to the scanned customer too.
  //
  // EXCEPT: if a CREDIT line already exists and is attached to a *different*
  // customer than the one just scanned, that would silently re-attribute
  // already-owed money — block instead of overwrite (bug fix, see
  // hasCreditCustomerConflict above). The DSM must remove the existing
  // CREDIT line first before a different customer can be attached.
  const handleCustomerResolved = (customer: CustomerLookup) => {
    if (
      hasCreditCustomerConflict({
        hasCreditLine,
        creditCustomerId,
        creditQuickAdd,
        scannedCustomerId: customer.customerId,
      })
    ) {
      setScanConflictError(
        `This bill already has a CREDIT payment for ${creditCustomerLabel ?? 'another customer'}. ` +
          'Remove that credit line before attaching a different customer.',
      );
      setScanVisible(false);
      return;
    }

    setScanConflictError(null);
    setScannedCustomer(customer);
    setCustomerName(customer.name);
    if (customer.vehicleNumber) {
      setVehicleNumber(customer.vehicleNumber);
    }
    setCreditCustomerId(undefined);
    setCreditQuickAdd(undefined);
    setCreditCustomerLabel(undefined);
    setScanVisible(false);
  };

  // Detach the scanned customer but keep the auto-filled text fields — the
  // DSM may be correcting a wrong scan, and Section 4's vehicle/name rule
  // still applies to whatever remains.
  const handleRemoveScannedCustomer = () => {
    setScannedCustomer(null);
    setPointsPreview(null);
  };

  const requestCreditCustomer = (): Promise<boolean> => {
    return new Promise((resolve) => {
      creditResolveRef.current = resolve;
      setCreditPickerVisible(true);
    });
  };

  const handleSelectExistingCustomer = (customer: CustomerSummary) => {
    setCreditCustomerId(customer.id);
    setCreditQuickAdd(undefined);
    setCreditCustomerLabel(
      `${customer.name}${customer.vehicleNumber ? ' · ' + customer.vehicleNumber : ''}`,
    );
    setCreditPickerVisible(false);
    creditResolveRef.current?.(true);
    creditResolveRef.current = null;
  };

  const handleQuickAddCustomer = (input: QuickAddCustomerInput) => {
    setCreditQuickAdd(input);
    setCreditCustomerId(undefined);
    setCreditCustomerLabel(`${input.name} · ${input.vehicleNumber} (new)`);
    setCreditPickerVisible(false);
    creditResolveRef.current?.(true);
    creditResolveRef.current = null;
  };

  const handleCancelCreditPicker = () => {
    setCreditPickerVisible(false);
    creditResolveRef.current?.(false);
    creditResolveRef.current = null;
  };

  const handleAddLines = (newLines: BillPaymentLineInput[]) => {
    setLines((prev) => [...prev, ...newLines.map((line) => ({ ...line, localId: makeLocalId() }))]);
    setAddPaymentVisible(false);
  };

  // Section 3.4A — "if the DSM removes the CREDIT line before saving, clear
  // whichever of the two was set." Checked right here rather than in an
  // effect watching `lines`, so the line removal and the credit-field clear
  // land in the same state update instead of one render apart.
  const handleRemoveLine = (localId: string) => {
    const nextLines = lines.filter((line) => line.localId !== localId);
    setLines(nextLines);
    const stillHasCredit = nextLines.some((line) => line.paymentType === 'CREDIT');
    if (!stillHasCredit && (creditCustomerId || creditQuickAdd)) {
      setCreditCustomerId(undefined);
      setCreditQuickAdd(undefined);
      setCreditCustomerLabel(undefined);
      // Removing the CREDIT line is exactly the fix a scanConflictError asks
      // the DSM to make — clear the (now stale) message once they've done it.
      setScanConflictError(null);
    }
  };

  const resetForm = () => {
    setVehicleNumber('');
    setCustomerName('');
    setAmountInput('');
    setLitresInput('');
    setRateAppliedInput('');
    setProductType('PETROL');
    setLines([]);
    setCreditCustomerId(undefined);
    setCreditQuickAdd(undefined);
    setCreditCustomerLabel(undefined);
    setScannedCustomer(null);
    setPointsPreview(null);
    setSuccessBill(null);
    setSubmitError(null);
    setScanConflictError(null);
    setSavingReceipt(false);
    setSavedReceipt(null);
    setReceiptError(null);
    setSharingReceipt(false);
    setShareError(null);
  };

  const handleSaveReceiptPdf = async () => {
    if (!successBill) return;
    setSavingReceipt(true);
    setReceiptError(null);
    setShareError(null);
    try {
      const saved = await generateAndSaveReceiptPdf(successBill);
      setSavedReceipt(saved);
    } catch (error) {
      const message = error instanceof ReceiptError ? error.message : 'Could not save the receipt PDF.';
      setReceiptError(message);
    } finally {
      setSavingReceipt(false);
    }
  };

  const handleShareReceipt = async () => {
    if (!savedReceipt) return;
    setSharingReceipt(true);
    setShareError(null);
    try {
      await shareReceiptPdf(savedReceipt.uri);
    } catch (error) {
      const message = error instanceof ReceiptError ? error.message : 'Could not share the receipt.';
      setShareError(message);
    } finally {
      setSharingReceipt(false);
    }
  };

  const handleSave = async () => {
    if (!canSave) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const bill = await createBill(
        {
          customerId: effectiveCustomerId,
          quickAddCustomer: creditQuickAdd,
          vehicleNumber: vehicleNumber.trim() || undefined,
          customerName: customerName.trim() || undefined,
          amount,
          litres,
          productType,
          rateApplied,
          enteredById: staff.id,
          entryChannel: 'DSM_APP',
          paymentLines: lines.map(({ paymentType, amount: lineAmount, direction }) => ({
            paymentType,
            amount: lineAmount,
            direction,
          })),
        },
        accessToken,
      );
      setSuccessBill(bill);
    } catch (error) {
      const message = error instanceof BillsApiError ? error.message : 'Something went wrong. Please try again.';
      setSubmitError(message);
    } finally {
      setSubmitting(false);
    }
  };

  if (successBill) {
    return (
      <View style={styles.container}>
        <View style={styles.successBox} testID="bill-success">
          <Text style={styles.successTitle}>Bill saved</Text>
          <Text style={styles.resultLine}>Amount: ₹{successBill.amount.toFixed(2)}</Text>
          <Text style={styles.resultLine}>Litres: {successBill.litres}</Text>
          <Text style={styles.resultLine}>Product: {successBill.productType}</Text>
          {successBill.customerId && successBill.loyaltyPointsEarned > 0 ? (
            <Text style={styles.resultLine} testID="points-earned-line">
              Points earned: {successBill.loyaltyPointsEarned.toFixed(2)}
            </Text>
          ) : null}
        </View>

        {successBill.loyaltyWarning ? (
          // Non-blocking warning banner (same pattern as §8A.3's warning
          // banners): the bill IS saved — loyalty just isn't configured, so
          // no points were credited. Owner action, not a DSM error.
          <View style={styles.warningBanner} testID="loyalty-warning-banner">
            <Text style={styles.warningBannerText}>{successBill.loyaltyWarning}</Text>
          </View>
        ) : null}

        <View style={styles.receiptSection}>
          {savedReceipt ? (
            <Text style={styles.resultLine} testID="receipt-saved-label">
              Receipt saved: {savedReceipt.fileName}
            </Text>
          ) : null}

          {receiptError ? (
            <Text style={styles.error} testID="receipt-error">
              {receiptError}
            </Text>
          ) : null}

          <Pressable
            style={[styles.buttonSecondary, savingReceipt && styles.buttonDisabledOutline]}
            onPress={() => { void handleSaveReceiptPdf(); }}
            disabled={savingReceipt}
            testID="save-receipt-pdf-button"
          >
            {savingReceipt ? (
              <ActivityIndicator color="#1a73e8" />
            ) : (
              <Text style={styles.buttonSecondaryText}>
                {savedReceipt ? 'Save Receipt as PDF Again' : 'Save Receipt as PDF'}
              </Text>
            )}
          </Pressable>

          {shareError ? (
            <Text style={styles.error} testID="share-error">
              {shareError}
            </Text>
          ) : null}

          {savedReceipt ? (
            <Pressable
              style={[styles.buttonSecondary, sharingReceipt && styles.buttonDisabledOutline]}
              onPress={() => { void handleShareReceipt(); }}
              disabled={sharingReceipt}
              testID="share-receipt-button"
            >
              {sharingReceipt ? (
                <ActivityIndicator color="#1a73e8" />
              ) : (
                <Text style={styles.buttonSecondaryText}>Share Receipt</Text>
              )}
            </Pressable>
          ) : null}
        </View>

        <Pressable style={styles.button} onPress={resetForm} testID="new-bill-again-button">
          <Text style={styles.buttonText}>Enter Another Bill</Text>
        </Pressable>
        <Pressable style={styles.backButton} onPress={onBack} testID="new-bill-back-button">
          <Text style={styles.backButtonText}>Back to Menu</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>New Bill</Text>

        {/* Section 14 mockup — QR scan is the primary action, large, at the
            top; the text fields below stay as the walk-in fallback path. */}
        {scannedCustomer ? (
          <View
            style={[
              styles.customerChip,
              // Section 3.4A — INFORMAL (never formally vetted) customers get
              // the yellow treatment everywhere they appear.
              scannedCustomer.verificationStatus === 'INFORMAL' && styles.customerChipInformal,
            ]}
            testID="scanned-customer-chip"
          >
            <View style={styles.customerChipBody}>
              <Text style={styles.customerChipName}>
                {scannedCustomer.name}
                {scannedCustomer.verificationStatus === 'INFORMAL' ? '  ·  INFORMAL' : ''}
              </Text>
              <Text style={styles.customerChipId}>{scannedCustomer.qrMemberId}</Text>
            </View>
            <Pressable onPress={handleRemoveScannedCustomer} disabled={submitting} testID="remove-scanned-customer">
              <Text style={styles.removeText}>Remove</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            style={styles.scanButton}
            onPress={() => {
              setScanConflictError(null);
              setScanVisible(true);
            }}
            disabled={submitting}
            testID="scan-qr-button"
          >
            <Text style={styles.buttonText}>Scan Customer QR</Text>
          </Pressable>
        )}

        {scanConflictError ? (
          // Blocking inline error — mirrors submitError's pattern. This is
          // NOT a toast: it stays on screen until the DSM either removes the
          // existing CREDIT line or explicitly re-attempts the scan.
          <Text style={styles.error} testID="scan-conflict-error">
            {scanConflictError}
          </Text>
        ) : null}

        <Text style={styles.label}>Vehicle Number</Text>
        <TextInput
          style={styles.input}
          value={vehicleNumber}
          onChangeText={setVehicleNumber}
          placeholder="e.g. DL01AB1234"
          autoCapitalize="characters"
          editable={!submitting}
          testID="vehicle-number-input"
        />

        <Text style={styles.label}>Customer Name</Text>
        <TextInput
          style={styles.input}
          value={customerName}
          onChangeText={setCustomerName}
          placeholder="e.g. Ramesh Kumar"
          editable={!submitting}
          testID="customer-name-input"
        />

        {!hasVehicleOrName ? (
          <Text style={styles.hint}>Vehicle number or customer name is required.</Text>
        ) : null}

        <Text style={styles.label}>Amount (₹)</Text>
        <TextInput
          style={styles.input}
          value={amountInput}
          onChangeText={setAmountInput}
          placeholder="e.g. 1000"
          keyboardType="decimal-pad"
          editable={!submitting}
          testID="amount-input"
        />

        <Text style={styles.label}>Litres</Text>
        <TextInput
          style={styles.input}
          value={litresInput}
          onChangeText={setLitresInput}
          placeholder="e.g. 20"
          keyboardType="decimal-pad"
          editable={!submitting}
          testID="litres-input"
        />

        <Text style={styles.label}>Rate Applied (₹/litre)</Text>
        <TextInput
          style={styles.input}
          value={rateAppliedInput}
          onChangeText={setRateAppliedInput}
          placeholder="e.g. 96.50"
          keyboardType="decimal-pad"
          editable={!submitting}
          testID="rate-applied-input"
        />

        <Text style={styles.label}>Product Type</Text>
        <View style={styles.productRow}>
          {PRODUCT_TYPES.map((option) => (
            <Pressable
              key={option}
              style={[styles.productButton, productType === option && styles.productButtonSelected]}
              onPress={() => setProductType(option)}
              disabled={submitting}
              testID={`product-type-${option}`}
            >
              <Text style={[styles.productButtonText, productType === option && styles.productButtonTextSelected]}>
                {option}
              </Text>
            </Pressable>
          ))}
        </View>

        {pointsPreview && scannedCustomerId && (amount > 0 || litres > 0) ? (
          // Section 6.3 step 4 / Section 14 mockup — the DSM sees the points
          // this bill will earn BEFORE saving, so they can confirm it looks
          // right. Display only: the server recalculates authoritatively at
          // save time (Section 6.2 — the DSM never sees or picks a rate;
          // showing the applied basis/rate read-only is how they confirm).
          <View style={styles.pointsBanner} testID="points-preview-banner">
            <Text style={styles.pointsBannerText}>
              Loyalty: +{pointsPreview.points.toFixed(2)} points on this bill
            </Text>
            <Text style={styles.pointsBannerSub}>
              {pointsPreview.basis === 'RUPEE'
                ? `${pointsPreview.rate} pt per ₹100`
                : `${pointsPreview.rate} pt per litre`}
              {pointsPreview.rateSource === 'CUSTOMER_OVERRIDE' ? ' · customer-specific rate' : ''}
            </Text>
          </View>
        ) : null}

        <View style={styles.paymentsSection}>
          <Text
            style={[styles.remainingTicker, balanced ? styles.remainingBalanced : styles.remainingUnbalanced]}
            testID="remaining-ticker"
          >
            Remaining to collect: ₹{remaining.toFixed(2)}
          </Text>

          {lines.map((line) => (
            <View key={line.localId} style={styles.lineRow} testID={`payment-line-${line.localId}`}>
              <Text style={styles.lineText}>
                {line.paymentType} {line.direction === 'OUT' ? '(change)' : ''}: ₹{line.amount.toFixed(2)}
              </Text>
              <Pressable onPress={() => handleRemoveLine(line.localId)} testID={`remove-line-${line.localId}`}>
                <Text style={styles.removeText}>Remove</Text>
              </Pressable>
            </View>
          ))}

          {hasCreditCustomer ? (
            <Text style={styles.creditLabel} testID="credit-customer-label">
              Credit customer: {creditCustomerLabel}
            </Text>
          ) : null}

          <Pressable
            style={styles.buttonSecondary}
            onPress={() => setAddPaymentVisible(true)}
            disabled={submitting}
            testID="add-payment-button"
          >
            <Text style={styles.buttonSecondaryText}>Add Payment</Text>
          </Pressable>
        </View>

        {submitError ? (
          <Text style={styles.error} testID="submit-error">
            {submitError}
          </Text>
        ) : null}

        <Pressable
          style={[styles.button, !canSave && styles.buttonDisabled]}
          onPress={() => { void handleSave(); }}
          disabled={!canSave}
          testID="save-bill-button"
        >
          {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save</Text>}
        </Pressable>

        {!canSave && !submitting && missingReasons.length > 0 ? (
          <Text style={styles.hint} testID="save-disabled-hint">
            Still need: {missingReasons.join(', ')}.
          </Text>
        ) : null}

        <Pressable style={styles.backButton} onPress={onBack} testID="new-bill-cancel-button">
          <Text style={styles.backButtonText}>Back</Text>
        </Pressable>
      </ScrollView>

      <AddPaymentModal
        visible={addPaymentVisible}
        remaining={remaining}
        hasCreditCustomer={hasCreditCustomer}
        onRequestCreditCustomer={requestCreditCustomer}
        onAddLines={handleAddLines}
        onClose={() => setAddPaymentVisible(false)}
      />

      <CreditCustomerPicker
        visible={creditPickerVisible}
        accessToken={accessToken}
        onSelectExisting={handleSelectExistingCustomer}
        onQuickAdd={handleQuickAddCustomer}
        onCancel={handleCancelCreditPicker}
      />

      <ScanCustomerModal
        visible={scanVisible}
        accessToken={accessToken}
        onResolved={handleCustomerResolved}
        onCancel={() => setScanVisible(false)}
      />
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
  hint: {
    color: '#b26a00',
    marginBottom: 12,
    fontSize: 13,
  },
  scanButton: {
    backgroundColor: '#1a73e8',
    borderRadius: 8,
    paddingVertical: 18,
    alignItems: 'center',
    marginBottom: 20,
  },
  customerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#c8e0c9',
    backgroundColor: '#e6f4ea',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 20,
  },
  // Section 3.4A yellow treatment for INFORMAL customers.
  customerChipInformal: {
    borderColor: '#f0c36d',
    backgroundColor: '#fff8e1',
  },
  customerChipBody: {
    flex: 1,
  },
  customerChipName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#333',
  },
  customerChipId: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
  },
  pointsBanner: {
    backgroundColor: '#e8f0fe',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  pointsBannerText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#174ea6',
  },
  pointsBannerSub: {
    fontSize: 13,
    color: '#174ea6',
    marginTop: 2,
  },
  warningBanner: {
    marginHorizontal: 24,
    marginBottom: 8,
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
  error: {
    color: '#b00020',
    marginTop: 4,
    marginBottom: 12,
  },
  productRow: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  productButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#1a73e8',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginRight: 8,
  },
  productButtonSelected: {
    backgroundColor: '#1a73e8',
  },
  productButtonText: {
    color: '#1a73e8',
    fontWeight: '600',
  },
  productButtonTextSelected: {
    color: '#fff',
  },
  paymentsSection: {
    marginTop: 8,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#eee',
    marginBottom: 8,
  },
  remainingTicker: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
  },
  remainingBalanced: {
    color: '#188038',
  },
  remainingUnbalanced: {
    color: '#1a73e8',
  },
  lineRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  lineText: {
    fontSize: 15,
    color: '#333',
  },
  removeText: {
    color: '#b00020',
    fontWeight: '600',
  },
  creditLabel: {
    marginTop: 8,
    fontSize: 13,
    color: '#444',
  },
  button: {
    backgroundColor: '#1a73e8',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
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
    marginTop: 8,
  },
  buttonSecondaryText: {
    color: '#1a73e8',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonDisabledOutline: {
    borderColor: '#9db8e8',
  },
  receiptSection: {
    marginHorizontal: 24,
    marginTop: 4,
    marginBottom: 8,
  },
  backButton: {
    marginTop: 16,
    alignItems: 'center',
  },
  backButtonText: {
    color: '#1a73e8',
    fontSize: 15,
    fontWeight: '600',
  },
  successBox: {
    margin: 24,
    backgroundColor: '#e6f4ea',
    borderRadius: 8,
    padding: 20,
  },
  successTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#188038',
    marginBottom: 12,
  },
  resultLine: {
    fontSize: 15,
    color: '#333',
    marginBottom: 4,
  },
});
