import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { StaffSummary } from '../api/authApi';
import { AttendanceScreen } from './AttendanceScreen';
import { MeterReadingScreen } from './MeterReadingScreen';
import { NewBillScreen } from './NewBillScreen';
import { ShiftSalesSummaryScreen } from './ShiftSalesSummaryScreen';
import { getPendingCount, syncOfflineBills } from '../offline/offlineBillQueue';

interface Props {
  staff: StaffSummary;
  accessToken: string;
  onLogOut: () => void;
}

type MenuScreen = 'home' | 'meterReading' | 'newBill' | 'shiftSalesSummary' | 'attendance';

// Home/menu screen after login. No navigation library — a manual local
// state machine swaps between this menu and the feature screens built so
// far (Meter Reading, New Bill, Shift Sales Summary, Attendance). Further
// screens (QR scan, Bluetooth printing, biometric login) are separate,
// later slices per Section 4.
export function LoggedInScreen({ staff, accessToken, onLogOut }: Props) {
  const [screen, setScreen] = useState<MenuScreen>('home');

  // Section 17.6 — offline bill queue sync surface. No NetInfo/connectivity-
  // change listener exists in this app (would be a new native dependency —
  // out of scope here, see offlineBillQueue.ts's WatermelonDB writeup for
  // the same kind of dependency-avoidance call). Instead: opportunistically
  // attempt a sync every time the DSM lands back on this Home screen (after
  // login, or returning from any other screen) — cheap, dependency-free,
  // and covers the common case (DSM steps back into signal, returns to
  // Home, queue drains) — plus a manual "Sync now" button for immediate
  // control.
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  async function refreshPendingCount() {
    setPendingCount(await getPendingCount());
  }

  async function attemptSync() {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const result = await syncOfflineBills(accessToken);
      if (result.succeeded > 0 || result.failed > 0) {
        setSyncMessage(
          `Synced ${result.succeeded} bill${result.succeeded === 1 ? '' : 's'}` +
            (result.failed > 0 ? `, ${result.failed} still need attention` : ''),
        );
      }
    } catch {
      // syncOfflineBills() itself doesn't throw for individual bill
      // failures (those are captured per-entry) — a throw here would mean
      // something broke reading/writing the queue itself. Fail quietly;
      // the pending count staying nonzero is signal enough, and the next
      // Home-screen visit or manual Sync tap will retry.
    } finally {
      await refreshPendingCount();
      setSyncing(false);
    }
  }

  useEffect(() => {
    if (screen !== 'home') return;
    void attemptSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

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

  if (screen === 'attendance') {
    return <AttendanceScreen staff={staff} accessToken={accessToken} onBack={() => setScreen('home')} />;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>DSM Home</Text>
      <Text style={styles.confirmation}>
        Logged in as {staff.name} ({staff.role})
      </Text>
      <Text style={styles.detail}>Phone: {staff.phone}</Text>

      {(pendingCount > 0 || syncing || syncMessage) && (
        <View style={styles.syncBanner} testID="offline-sync-banner">
          {syncing ? (
            <ActivityIndicator size="small" color="#1a73e8" />
          ) : (
            <Text style={styles.syncBannerText} testID="pending-sync-count">
              {pendingCount > 0
                ? `${pendingCount} bill${pendingCount === 1 ? '' : 's'} pending sync`
                : syncMessage}
            </Text>
          )}
          {pendingCount > 0 && !syncing && (
            <Pressable
              onPress={() => {
                void attemptSync();
              }}
              testID="sync-now-button"
            >
              <Text style={styles.syncNowText}>Sync now</Text>
            </Pressable>
          )}
        </View>
      )}

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

      <Pressable style={styles.menuButton} onPress={() => setScreen('attendance')} testID="menu-attendance">
        <Text style={styles.menuButtonText}>Attendance</Text>
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
  syncBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff8e1',
    borderWidth: 1,
    borderColor: '#f0c36d',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
    width: '100%',
  },
  syncBannerText: {
    fontSize: 13,
    color: '#7a5b00',
    flexShrink: 1,
  },
  syncNowText: {
    color: '#1a73e8',
    fontWeight: '700',
    fontSize: 13,
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
