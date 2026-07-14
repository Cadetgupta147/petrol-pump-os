import AsyncStorage from '@react-native-async-storage/async-storage';
import type { StaffSummary } from '../api/authApi';

// Minimal local persistence for the logged-in session: the JWT plus the
// staff summary returned alongside it. This is just a token cache, not the
// offline-first bill-entry queue described in Section 15.3 (that's
// WatermelonDB, explicitly deferred — out of scope for this slice).
const ACCESS_TOKEN_KEY = 'dsmApp.accessToken';
const STAFF_KEY = 'dsmApp.staff';

export interface StoredSession {
  accessToken: string;
  staff: StaffSummary;
}

export async function saveSession(session: StoredSession): Promise<void> {
  await AsyncStorage.multiSet([
    [ACCESS_TOKEN_KEY, session.accessToken],
    [STAFF_KEY, JSON.stringify(session.staff)],
  ]);
}

export async function loadSession(): Promise<StoredSession | null> {
  const [[, accessToken], [, staffJson]] = await AsyncStorage.multiGet([ACCESS_TOKEN_KEY, STAFF_KEY]);
  if (!accessToken || !staffJson) {
    return null;
  }
  return { accessToken, staff: JSON.parse(staffJson) as StaffSummary };
}

export async function clearSession(): Promise<void> {
  await AsyncStorage.multiRemove([ACCESS_TOKEN_KEY, STAFF_KEY]);
}
