import AsyncStorage from '@react-native-async-storage/async-storage';
import type { StaffSummary } from '../api/authApi';

// Minimal local persistence for the logged-in session: the JWT plus the
// staff summary returned alongside it. This is just a token cache, not the
// offline-first bill-entry queue described in Section 15.3/17.6 — that's
// offline/offlineBillQueue.ts (AsyncStorage-backed, not WatermelonDB as
// Section 15.3 originally recommended — see that file's comment for why).
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
  try {
    return { accessToken, staff: JSON.parse(staffJson) as StaffSummary };
  } catch {
    // Corrupted STAFF_KEY (interrupted write, or a stale shape from an
    // older app version) — this would otherwise throw identically on every
    // future launch, since the bad bytes never change on their own. Wipe it
    // so the DSM logs in once and gets a clean session going forward,
    // instead of failing silently forever.
    await clearSession();
    return null;
  }
}

export async function clearSession(): Promise<void> {
  await AsyncStorage.multiRemove([ACCESS_TOKEN_KEY, STAFF_KEY]);
}
