import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import type { PinLoginResponse, StaffSummary } from './src/api/authApi';
import { PinLoginScreen } from './src/screens/PinLoginScreen';
import { LoggedInScreen } from './src/screens/LoggedInScreen';
import { clearSession, loadSession, saveSession } from './src/storage/sessionStorage';

// App-level state machine for this slice: checking stored session -> either
// the PIN login screen or the logged-in confirmation screen. No navigation
// library — a single screen (plus its logged-in confirmation state) doesn't
// need one yet.
export default function App() {
  const [checkingSession, setCheckingSession] = useState(true);
  const [staff, setStaff] = useState<StaffSummary | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);

  useEffect(() => {
    loadSession()
      .then((session) => {
        if (session) {
          setStaff(session.staff);
          setAccessToken(session.accessToken);
        }
      })
      .catch((err: unknown) => {
        // Real AsyncStorage I/O failure — the corrupted-JSON case is
        // already self-healed inside loadSession() and never reaches here.
        // Don't clear the stored session over what may be a transient read
        // failure: just fall through to the PIN login screen for this
        // launch (same as "no session found") and leave storage alone so a
        // later successful read can still restore it.
        console.warn('loadSession() failed — treating this launch as no session', err);
      })
      .finally(() => setCheckingSession(false));
  }, []);

  const handleLoginSuccess = async (response: PinLoginResponse) => {
    setSessionError(null);
    try {
      await saveSession(response);
      setStaff(response.staff);
      setAccessToken(response.accessToken);
    } catch (err) {
      // saveSession() failed (AsyncStorage write error). Without this, the
      // DSM already got a successful server login, then this silently does
      // nothing — the Log In button just resets with no explanation, and
      // they're stuck tapping it again with no indication anything's wrong.
      console.warn('handleLoginSuccess() failed to save session', err);
      setSessionError("Couldn't save session — try logging in again.");
    }
  };

  const handleLogOut = async () => {
    setSessionError(null);
    try {
      await clearSession();
      setStaff(null);
      setAccessToken(null);
    } catch (err) {
      console.warn('handleLogOut() failed to clear session', err);
      setSessionError("Couldn't log out — try again.");
    }
  };

  if (checkingSession) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
        <StatusBar style="auto" />
      </View>
    );
  }

  return (
    <>
      {sessionError ? (
        <View style={styles.errorBanner} testID="session-error-banner">
          <Text style={styles.errorBannerText}>{sessionError}</Text>
        </View>
      ) : null}
      {staff && accessToken ? (
        <LoggedInScreen
          staff={staff}
          accessToken={accessToken}
          onLogOut={() => { void handleLogOut(); }}
        />
      ) : (
        <PinLoginScreen onLoginSuccess={(response) => { void handleLoginSuccess(response); }} />
      )}
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
