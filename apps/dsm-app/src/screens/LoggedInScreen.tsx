import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { StaffSummary } from '../api/authApi';
import { MeterReadingScreen } from './MeterReadingScreen';
import { NewBillScreen } from './NewBillScreen';
import { ShiftSalesSummaryScreen } from './ShiftSalesSummaryScreen';

interface Props {
  staff: StaffSummary;
  accessToken: string;
  onLogOut: () => void;
}

type MenuScreen = 'home' | 'meterReading' | 'newBill' | 'shiftSalesSummary';

// Home/menu screen after login. No navigation library — a manual local
// state machine swaps between this menu and the feature screens built so
// far (Meter Reading, New Bill, Shift Sales Summary). Further screens (QR
// scan, Bluetooth printing, offline sync, biometric login) are separate,
// later slices per Section 4.
export function LoggedInScreen({ staff, accessToken, onLogOut }: Props) {
  const [screen, setScreen] = useState<MenuScreen>('home');

  if (screen === 'meterReading') {
    return (
      <MeterReadingScreen staff={staff} accessToken={accessToken} onBack={() => setScreen('home')} />
    );
  }

  if (screen === 'newBill') {
    return <NewBillScreen staff={staff} accessToken={accessToken} onBack={() => setScreen('home')} />;
  }

  if (screen === 'shiftSalesSummary') {
    return (
      <ShiftSalesSummaryScreen staff={staff} accessToken={accessToken} onBack={() => setScreen('home')} />
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>DSM Home</Text>
      <Text style={styles.confirmation}>
        Logged in as {staff.name} ({staff.role})
      </Text>
      <Text style={styles.detail}>Phone: {staff.phone}</Text>

      <Pressable style={styles.menuButton} onPress={() => setScreen('meterReading')} testID="menu-meter-reading">
        <Text style={styles.menuButtonText}>Meter Reading</Text>
      </Pressable>

      <Pressable style={styles.menuButton} onPress={() => setScreen('newBill')} testID="menu-new-bill">
        <Text style={styles.menuButtonText}>New Bill</Text>
      </Pressable>

      <Pressable
        style={styles.menuButton}
        onPress={() => setScreen('shiftSalesSummary')}
        testID="menu-shift-sales-summary"
      >
        <Text style={styles.menuButtonText}>Shift Sales Summary</Text>
      </Pressable>

      <Pressable style={styles.button} onPress={onLogOut} testID="logout-button">
        <Text style={styles.buttonText}>Log out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    backgroundColor: '#fff',
  },
  heading: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 16,
  },
  confirmation: {
    fontSize: 18,
    marginBottom: 8,
    textAlign: 'center',
  },
  detail: {
    fontSize: 14,
    color: '#555',
    marginBottom: 32,
  },
  menuButton: {
    backgroundColor: '#1a73e8',
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 32,
    marginBottom: 16,
    width: '100%',
    alignItems: 'center',
  },
  menuButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  button: {
    borderWidth: 1,
    borderColor: '#1a73e8',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
    marginTop: 16,
  },
  buttonText: {
    color: '#1a73e8',
    fontSize: 16,
    fontWeight: '600',
  },
});
