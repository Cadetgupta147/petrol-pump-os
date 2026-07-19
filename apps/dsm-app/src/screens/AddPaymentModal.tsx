import { useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { BillPaymentLineInput, PaymentType } from '../api/billsApi';

interface Props {
  visible: boolean;
  // "Remaining to collect" BEFORE this payment is added — Section 5A.3's
  // live ticker. Used both to size the overshoot prompt and to reject a
  // cash overshoot.
  remaining: number;
  // Whether a CREDIT customer (customerId or quickAddCustomer) has already
  // been resolved for this bill. If not, and the DSM picks Credit, we must
  // resolve one before the line can be added (there's only one
  // customerId/quickAddCustomer slot per bill — see NewBillScreen).
  hasCreditCustomer: boolean;
  // Opens the credit-customer picker and resolves to true once a customer
  // has been chosen/quick-added, or false if the DSM cancelled out of it.
  onRequestCreditCustomer: () => Promise<boolean>;
  onAddLines: (lines: BillPaymentLineInput[]) => void;
  onClose: () => void;
}

const EPSILON = 0.01;
const METHODS: PaymentType[] = ['CASH', 'CARD', 'UPI', 'CREDIT'];
const METHOD_LABELS: Record<PaymentType, string> = {
  CASH: 'Cash',
  CARD: 'Card',
  UPI: 'UPI',
  CREDIT: 'Credit',
};

// Section 5A.3 — "Add Payment" flow: DSM picks a method, enters an amount.
// - Non-cash overshoot (Card/UPI/Credit amount > remaining) prompts
//   "₹X extra — give as cash change?"; confirming auto-creates the entered
//   amount as an IN line plus a CASH OUT line for the overshoot. Declining
//   adds nothing, letting the DSM correct the amount instead.
// - Cash overshoot never prompts for change (not a system-tracked event per
//   the spec) — it's rejected inline instead of silently clamped.
export function AddPaymentModal({
  visible,
  remaining,
  hasCreditCustomer,
  onRequestCreditCustomer,
  onAddLines,
  onClose,
}: Props) {
  const [method, setMethod] = useState<PaymentType>('CASH');
  const [amountInput, setAmountInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Reset the form each time the modal opens. This component instance
  // persists across opens (it's a child kept mounted under <Modal>, not
  // remounted), so this compares against the previous `visible` value
  // during render rather than reacting to it in an effect.
  const [prevVisible, setPrevVisible] = useState(visible);
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    if (visible) {
      setMethod('CASH');
      setAmountInput('');
      setError(null);
      setBusy(false);
    }
  }

  const handleAdd = async () => {
    const amount = Number(amountInput);
    if (!amountInput.trim() || Number.isNaN(amount) || amount <= 0) {
      setError('Enter a valid amount greater than ₹0.');
      return;
    }

    if (method === 'CREDIT' && !hasCreditCustomer) {
      setBusy(true);
      const resolved = await onRequestCreditCustomer();
      setBusy(false);
      if (!resolved) {
        // DSM cancelled the customer picker — leave the modal open so they
        // can adjust the method/amount instead of losing their place.
        return;
      }
    }

    const overshoot = amount - remaining;

    if (method === 'CASH') {
      if (overshoot > EPSILON) {
        setError(`Cash amount can't exceed the remaining ₹${remaining.toFixed(2)}.`);
        return;
      }
      onAddLines([{ paymentType: 'CASH', amount, direction: 'IN' }]);
      return;
    }

    // Non-cash method (Card/UPI/Credit).
    if (overshoot > EPSILON) {
      Alert.alert('Cash change', `₹${overshoot.toFixed(2)} extra — give as cash change?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: () => {
            onAddLines([
              { paymentType: method, amount, direction: 'IN' },
              { paymentType: 'CASH', amount: overshoot, direction: 'OUT' },
            ]);
          },
        },
      ]);
      return;
    }

    onAddLines([{ paymentType: method, amount, direction: 'IN' }]);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Add Payment</Text>
          <Text style={styles.remaining}>Remaining to collect: ₹{remaining.toFixed(2)}</Text>

          <View style={styles.methodRow}>
            {METHODS.map((option) => (
              <Pressable
                key={option}
                style={[styles.methodButton, method === option && styles.methodButtonSelected]}
                onPress={() => {
                  setMethod(option);
                  setError(null);
                }}
                testID={`payment-method-${option}`}
              >
                <Text style={[styles.methodButtonText, method === option && styles.methodButtonTextSelected]}>
                  {METHOD_LABELS[option]}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.label}>Amount</Text>
          <TextInput
            style={styles.input}
            value={amountInput}
            onChangeText={(value) => {
              setAmountInput(value);
              setError(null);
            }}
            placeholder="e.g. 500"
            keyboardType="decimal-pad"
            editable={!busy}
            testID="payment-amount-input"
          />

          {error ? (
            <Text style={styles.error} testID="add-payment-error">
              {error}
            </Text>
          ) : null}

          <Pressable style={[styles.button, busy && styles.buttonDisabled]} onPress={() => { void handleAdd(); }} disabled={busy} testID="confirm-add-payment-button">
            <Text style={styles.buttonText}>Add</Text>
          </Pressable>
          <Pressable style={styles.linkButton} onPress={onClose} testID="cancel-add-payment-button">
            <Text style={styles.linkButtonText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 24,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  remaining: {
    fontSize: 15,
    color: '#1a73e8',
    fontWeight: '600',
    marginBottom: 16,
    textAlign: 'center',
  },
  methodRow: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  methodButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#1a73e8',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  methodButtonSelected: {
    backgroundColor: '#1a73e8',
  },
  methodButtonText: {
    color: '#1a73e8',
    fontWeight: '600',
  },
  methodButtonTextSelected: {
    color: '#fff',
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
  button: {
    backgroundColor: '#1a73e8',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonDisabled: {
    backgroundColor: '#9db8e8',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  linkButton: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  linkButtonText: {
    color: '#1a73e8',
    fontSize: 15,
    fontWeight: '600',
  },
});
