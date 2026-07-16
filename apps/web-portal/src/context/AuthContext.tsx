import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import { login as loginRequest } from '../api/auth';
import { getStoredToken, setStoredToken } from '../api/client';
import type { StaffSummary } from '../api/types';

const STAFF_STORAGE_KEY = 'pumpos.staff';

interface AuthContextValue {
  staff: StaffSummary | null;
  isAuthenticated: boolean;
  login: (phone: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

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

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
