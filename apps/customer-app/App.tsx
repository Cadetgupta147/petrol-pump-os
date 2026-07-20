import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import type { VerifyOtpResponse, CustomerSummary } from './src/api/customerAuthApi';
import { PhoneEntryScreen } from './src/screens/PhoneEntryScreen';
import { OtpEntryScreen } from './src/screens/OtpEntryScreen';
import { LoggedInPlaceholderScreen } from './src/screens/LoggedInPlaceholderScreen';
import {
  clearCustomerSession,
  loadCustomerSession,
  saveCustomerSession,
} from './src/storage/customerSessionStorage';

// App-level state machine for this slice: checking stored session -> phone
// entry -> OTP entry -> logged-in placeholder. No navigation library — three
// screens don't need one yet (same reasoning as apps/dsm-app/App.tsx).
//
// Task scope note: phone number + OTP login ONLY. Nothing here routes to any
// other feature (bill history, points, gift catalog, dues/"Pay Now") — those
// are separate, later slices per docs/master-plan.md Section 5.
type Stage =
  | { name: 'checkingSession' }
  | { name: 'phoneEntry' }
  | { name: 'otpEntry'; phone: string; requestId: string; expiresInSeconds: number }
  | { name: 'loggedIn'; customer: CustomerSummary };

export default function App() {
  const [stage, setStage] = useState<Stage>({ name: 'checkingSession' });
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);

  useEffect(() => {
    loadCustomerSession()
      .then((session) => {
        if (session) {
          setAccessToken(session.accessToken);
          setStage({ name: 'loggedIn', customer: session.customer });
        } else {
          setStage({ name: 'phoneEntry' });
        }
      })
      .catch((err: unknown) => {
        // Real AsyncStorage I/O failure — the corrupted-JSON case is already
        // self-healed inside loadCustomerSession() and never reaches here.
        // Don't clear stored session data over what may be a transient read
        // failure: just fall through to phone entry for this launch, same as
        // apps/dsm-app/App.tsx's identical reasoning.
        console.warn('loadCustomerSession() failed — treating this launch as no session', err);
        setStage({ name: 'phoneEntry' });
      });
  }, []);

  const handleOtpRequested = (phone: string, requestId: string, expiresInSeconds: number) => {
    setSessionError(null);
    setStage({ name: 'otpEntry', phone, requestId, expiresInSeconds });
  };

  const handleVerified = async (response: VerifyOtpResponse) => {
    setSessionError(null);
    try {
      await saveCustomerSession(response);
      setAccessToken(response.accessToken);
      setStage({ name: 'loggedIn', customer: response.customer });
    } catch (err) {
      // saveCustomerSession() failed (AsyncStorage write error). Without
      // this, the customer already got a successful server login, then this
      // silently does nothing — same reasoning as
      // apps/dsm-app/App.tsx's handleLoginSuccess().
      console.warn('handleVerified() failed to save session', err);
      setSessionError("Couldn't save session — try logging in again.");
    }
  };

  const handleLogOut = async () => {
    setSessionError(null);
    try {
      await clearCustomerSession();
      setAccessToken(null);
      setStage({ name: 'phoneEntry' });
    } catch (err) {
      console.warn('handleLogOut() failed to clear session', err);
      setSessionError("Couldn't log out — try again.");
    }
  };

  let content;
  if (stage.name === 'checkingSession') {
    content = (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  } else if (stage.name === 'phoneEntry') {
    content = <PhoneEntryScreen onOtpRequested={handleOtpRequested} />;
  } else if (stage.name === 'otpEntry') {
    content = (
      <OtpEntryScreen
        phone={stage.phone}
        requestId={stage.requestId}
        expiresInSeconds={stage.expiresInSeconds}
        onVerified={(response) => {
          void handleVerified(response);
        }}
        onChangeNumber={() => setStage({ name: 'phoneEntry' })}
      />
    );
  } else if (stage.name === 'loggedIn' && accessToken) {
    content = (
      <LoggedInPlaceholderScreen
        customer={stage.customer}
        onLogOut={() => {
          void handleLogOut();
        }}
      />
    );
  } else {
    // Defensive fallback — shouldn't be reachable (loggedIn stage always
    // pairs with a saved accessToken), but keeps this exhaustive rather than
    // rendering nothing.
    content = <PhoneEntryScreen onOtpRequested={handleOtpRequested} />;
  }

  return (
    <>
      {sessionError ? (
        <View style={styles.errorBanner} testID="session-error-banner">
          <Text style={styles.errorBannerText}>{sessionError}</Text>
        </View>
      ) : null}
      {content}
      <StatusBar style="auto" />
    </>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  errorBanner: {
    backgroundColor: '#fdecea',
    borderBottomWidth: 1,
    borderBottomColor: '#f0c36d',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  errorBannerText: {
    color: '#b00020',
    fontSize: 13,
    textAlign: 'center',
  },
});
