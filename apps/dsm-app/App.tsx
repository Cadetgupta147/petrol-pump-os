import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
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

  useEffect(() => {
    loadSession()
      .then((session) => {
        if (session) {
          setStaff(session.staff);
          setAccessToken(session.accessToken);
        }
      })
      .finally(() => setCheckingSession(false));
  }, []);

  const handleLoginSuccess = async (response: PinLoginResponse) => {
    await saveSession(response);
    setStaff(response.staff);
    setAccessToken(response.accessToken);
  };

  const handleLogOut = async () => {
    await clearSession();
    setStaff(null);
    setAccessToken(null);
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
      {staff && accessToken ? (
        <LoggedInScreen staff={staff} accessToken={accessToken} onLogOut={handleLogOut} />
      ) : (
        <PinLoginScreen onLoginSuccess={handleLoginSuccess} />
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
});
