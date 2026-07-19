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
import { pinLogin, PinLoginError, type PinLoginResponse } from '../api/authApi';

interface Props {
  onLoginSuccess: (response: PinLoginResponse) => void;
}

// Section 4 — "PIN or biometric login": this screen implements the PIN half
// only (biometric is a separate, later slice). Staff enters phone + PIN,
// which the backend validates server-side (POST /auth/pin-login) — this
// screen does not attempt to locally judge whether a PIN is "valid" beyond
// requiring both fields be non-empty for the Log In button to be tappable;
// that is a UX nicety, not a security boundary (the server is the only
// authority on correctness, per CLAUDE.md's "never trust the frontend to
// enforce permissions").
export function PinLoginScreen({ onLoginSuccess }: Props) {
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canSubmit = phone.trim().length > 0 && pin.trim().length > 0 && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const response = await pinLogin(phone.trim(), pin.trim());
      onLoginSuccess(response);
    } catch (error) {
      const message = error instanceof PinLoginError ? error.message : 'Something went wrong. Please try again.';
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
      <Text style={styles.title}>DSM Login</Text>

      <Text style={styles.label}>Phone number</Text>
      <TextInput
        style={styles.input}
        value={phone}
        onChangeText={setPhone}
        placeholder="e.g. 9990000004"
        keyboardType="phone-pad"
        autoComplete="tel"
        autoCapitalize="none"
        editable={!submitting}
        testID="phone-input"
      />

      <Text style={styles.label}>PIN</Text>
      <TextInput
        style={styles.input}
        value={pin}
        onChangeText={setPin}
        placeholder="PIN"
        keyboardType="number-pad"
        secureTextEntry
        autoCapitalize="none"
        editable={!submitting}
        testID="pin-input"
      />

      {errorMessage ? (
        <Text style={styles.error} testID="login-error">
          {errorMessage}
        </Text>
      ) : null}

      <Pressable
        style={[styles.button, !canSubmit && styles.buttonDisabled]}
        onPress={() => { void handleSubmit(); }}
        disabled={!canSubmit}
        testID="login-button"
      >
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Log In</Text>}
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
    marginBottom: 16,
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
