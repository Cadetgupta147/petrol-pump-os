import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
} from 'react-native';
import {
  CustomerAuthError,
  requestOtp,
  verifyOtp,
  type VerifyOtpResponse,
} from '../api/customerAuthApi';

interface Props {
  phone: string;
  requestId: string;
  expiresInSeconds: number;
  onVerified: (response: VerifyOtpResponse) => void;
  onChangeNumber: () => void;
}

const OTP_LENGTH = 6;

// Section 5 — step two of phone + OTP login: enter the code sent to the
// phone number collected on PhoneEntryScreen, and verify it server-side.
//
// The resend cooldown timer here is a UX nicety only — it does NOT enforce
// any real rate limit. Per CLAUDE.md ("never trust the frontend to enforce
// permissions/security controls"), actual OTP request/verify rate limiting
// must be enforced server-side; this screen has no way to guarantee that and
// isn't attempting to.
export function OtpEntryScreen({ phone, requestId, expiresInSeconds, onVerified, onChangeNumber }: Props) {
  const [currentRequestId, setCurrentRequestId] = useState(requestId);
  const [otp, setOtp] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState(expiresInSeconds);

  useEffect(() => {
    if (secondsRemaining <= 0) return;
    const timer = setInterval(() => {
      setSecondsRemaining((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [secondsRemaining]);

  const canSubmit = otp.trim().length === OTP_LENGTH && !submitting;
  const canResend = secondsRemaining <= 0 && !resending;

  const handleVerify = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const response = await verifyOtp(phone, otp.trim(), currentRequestId);
      onVerified(response);
    } catch (error) {
      const message =
        error instanceof CustomerAuthError ? error.message : 'Something went wrong. Please try again.';
      setErrorMessage(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (!canResend) return;
    setResending(true);
    setErrorMessage(null);
    try {
      const response = await requestOtp(phone);
      setCurrentRequestId(response.requestId);
      setSecondsRemaining(response.expiresInSeconds);
      setOtp('');
    } catch (error) {
      const message =
        error instanceof CustomerAuthError ? error.message : 'Could not resend OTP. Please try again.';
      setErrorMessage(message);
    } finally {
      setResending(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Text style={styles.title}>Enter OTP</Text>
      <Text style={styles.subtitle}>Code sent to {phone}</Text>

      <TextInput
        style={styles.input}
        value={otp}
        onChangeText={(text) => setOtp(text.replace(/[^0-9]/g, '').slice(0, OTP_LENGTH))}
        placeholder={`${OTP_LENGTH}-digit code`}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        maxLength={OTP_LENGTH}
        editable={!submitting}
        testID="otp-input"
      />

      {errorMessage ? (
        <Text style={styles.error} testID="otp-entry-error">
          {errorMessage}
        </Text>
      ) : null}

      <Pressable
        style={[styles.button, !canSubmit && styles.buttonDisabled]}
        onPress={() => {
          void handleVerify();
        }}
        disabled={!canSubmit}
        testID="verify-otp-button"
      >
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Verify</Text>}
      </Pressable>

      <Pressable
        style={styles.secondaryButton}
        onPress={() => {
          void handleResend();
        }}
        disabled={!canResend}
        testID="resend-otp-button"
      >
        <Text style={[styles.secondaryButtonText, !canResend && styles.secondaryButtonTextDisabled]}>
          {resending
            ? 'Resending…'
            : canResend
              ? 'Resend OTP'
              : `Resend OTP in ${secondsRemaining}s`}
        </Text>
      </Pressable>

      <Pressable style={styles.linkButton} onPress={onChangeNumber} disabled={submitting} testID="change-number-button">
        <Text style={styles.linkButtonText}>Change phone number</Text>
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
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 20,
    letterSpacing: 4,
    textAlign: 'center',
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
  secondaryButton: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#1a73e8',
    fontSize: 14,
    fontWeight: '600',
  },
  secondaryButtonTextDisabled: {
    color: '#999',
  },
  linkButton: {
    paddingVertical: 8,
    alignItems: 'center',
  },
  linkButtonText: {
    color: '#666',
    fontSize: 13,
    textDecorationLine: 'underline',
  },
});
