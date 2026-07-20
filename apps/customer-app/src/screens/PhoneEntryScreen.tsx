import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
} from 'react-native';
import { CustomerAuthError, requestOtp } from '../api/customerAuthApi';

interface Props {
  onOtpRequested: (phone: string, requestId: string, expiresInSeconds: number) => void;
}

// Indian mobile number: exactly 10 digits, first digit 6-9. This isn't
// specified in docs/master-plan.md Section 5 (which only says "phone number +
// OTP") — it's a reasonable assumption given the rest of the product is
// India-specific (GST, OMC suppliers, Tally, WhatsApp), matching the same
// convention already used for Staff.phone elsewhere in this codebase. Flagged
// as an assumption, not a spec requirement.
const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/;

// Section 5 — "Login via phone number + OTP: no password to remember, no
// heavy signup." This screen is step one: collect + validate the phone
// number, then request an OTP be sent to it.
export function PhoneEntryScreen({ onOtpRequested }: Props) {
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const trimmedPhone = phone.trim();
  const isValidPhone = INDIAN_MOBILE_REGEX.test(trimmedPhone);
  const canSubmit = isValidPhone && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const response = await requestOtp(trimmedPhone);
      onOtpRequested(trimmedPhone, response.requestId, response.expiresInSeconds);
    } catch (error) {
      const message =
        error instanceof CustomerAuthError ? error.message : 'Something went wrong. Please try again.';
      setErrorMessage(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Text style={styles.title}>Welcome</Text>
      <Text style={styles.subtitle}>Enter your phone number to log in</Text>

      <Text style={styles.label}>Phone number</Text>
      <TextInput
        style={styles.input}
        value={phone}
        onChangeText={(text) => setPhone(text.replace(/[^0-9]/g, '').slice(0, 10))}
        placeholder="10-digit mobile number"
        keyboardType="phone-pad"
        autoComplete="tel"
        autoCapitalize="none"
        maxLength={10}
        editable={!submitting}
        testID="phone-input"
      />

      {phone.length > 0 && !isValidPhone ? (
        <Text style={styles.hint}>Enter a valid 10-digit mobile number.</Text>
      ) : null}

      {errorMessage ? (
        <Text style={styles.error} testID="phone-entry-error">
          {errorMessage}
        </Text>
      ) : null}

      <Pressable
        style={[styles.button, !canSubmit && styles.buttonDisabled]}
        onPress={() => {
          void handleSubmit();
        }}
        disabled={!canSubmit}
        testID="send-otp-button"
      >
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Send OTP</Text>}
      </Pressable>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    color: '#555',
    marginBottom: 32,
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
    marginBottom: 8,
  },
  hint: {
    fontSize: 12,
    color: '#8a6d00',
    marginBottom: 8,
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
    alignItems: 'center',
    marginTop: 16,
  },
  buttonDisabled: {
    backgroundColor: '#9db8e8',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
