import { useState, useCallback, useMemo, type ReactNode } from 'react';
import { login as loginRequest } from '../api/auth';
import { getStoredToken, setStoredToken } from '../api/client';
import { clearApiCache } from '../pwa/apiCache';
import type { StaffSummary } from '../api/types';
import { AuthContext, type AuthContextValue } from './useAuth';

const STAFF_STORAGE_KEY = 'pumpos.staff';

function readStoredStaff(): StaffSummary | null {
  const raw = localStorage.getItem(STAFF_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StaffSummary;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [staff, setStaff] = useState<StaffSummary | null>(readStoredStaff);

  const login = useCallback(async (phone: string, password: string) => {
    const result = await loginRequest(phone, password);
    setStoredToken(result.accessToken);
    localStorage.setItem(STAFF_STORAGE_KEY, JSON.stringify(result.staff));
    setStaff(result.staff);
  }, []);

  const logout = useCallback(() => {
    setStoredToken(null);
    localStorage.removeItem(STAFF_STORAGE_KEY);
    setStaff(null);
    // Wipe the service worker's cached API responses so the next login on this
    // device can't read the previous dealer's last-synced data offline.
    void clearApiCache();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      staff,
      isAuthenticated: staff !== null && getStoredToken() !== null,
      login,
      logout,
    }),
    [staff, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
