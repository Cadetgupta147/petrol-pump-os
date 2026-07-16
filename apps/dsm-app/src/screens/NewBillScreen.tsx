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
import type { CustomerSummary } from '../api/customersApi';
import { generateAndSaveReceiptPdf, ReceiptError, shareReceiptPdf, type SavedReceipt } from '../receipts/billReceipt';
import { AddPaymentModal } from './AddPaymentModal';
import { CreditCustomerPicker } from './CreditCustomerPicker';

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
// (full split-payment "Add Payment" flow). QR scan is explicitly out of
// scope for this slice — both vehicle number and customer name are plain
// text entry only.
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

  const [addPaymentVisible, setAddPaymentVisible] = useState(false);
  const [creditPickerVisible, setCreditPickerVisible] = useState(false);
  const creditResolveRef = useRef<((resolved: boolean) => void) | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successBill, setSuccessBill] = useState<Bill | null>(null);

  const [savingReceipt, setSavingReceipt] = useState(false);
  const [savedReceipt, setSavedReceipt] = useState<SavedReceipt | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [sharingReceipt, setSharingReceipt] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  // Section 3.4A — "if the DSM removes the CREDIT line before saving, clear
  // whichever of the two was set." Runs whenever the line list changes, not
  // just on explicit removal, so it also covers removing the last of
  // several CREDIT lines one at a time.
  useEffect(() => {
    const stillHasCredit = lines.some((line) => line.paymentType === 'CREDIT');
    if (!stillHasCredit && (creditCustomerId || creditQuickAdd)) {
      setCreditCustomerId(undefined);
      setCreditQuickAdd(undefined);
      setCreditCustomerLabel(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines]);

  const amount = Number(amountInput) || 0;
  const litres = Number(litresInput) || 0;
  const rateApplied = Number(rateAppliedInput) || 0;

  const sumIn = lines.filter((line) => line.direction === 'IN').reduce((total, line) => total + line.amount, 0);
  const sumOut = lines.filter((line) => line.direction === 'OUT').reduce((total, line) => total + line.amount, 0);
  // Section 5A.3 — the live "Remaining to collect" ticker.
  const remaining = amount - (sumIn - sumOut);
  const balanced = Math.abs(remaining) <= EPSILON;

  const hasVehicleOrName = vehicleNumber.trim().length > 0 || customerName.trim().length > 0;
  const hasCreditCustomer = !!creditCustomerId || !!creditQuickAdd;

  const canSave =
    !submitting &&
    hasVehicleOrName &&
    amount > 0 &&
    litres > 0 &&
    rateApplied > 0 &&
    lines.length > 0 &&
    balanced;

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

  const handleRemoveLine = (localId: string) => {
    setLines((prev) => prev.filter((line) => line.localId !== localId));
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
    setSuccessBill(null);
    setSubmitError(null);
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
          customerId: creditCustomerId,
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
        </View>

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
            onPress={handleSaveReceiptPdf}
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
              onPress={handleShareReceipt}
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
          onPress={handleSave}
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
