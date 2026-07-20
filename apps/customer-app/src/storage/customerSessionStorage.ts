import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CustomerSummary } from '../api/customerAuthApi';

// Minimal local persistence for the logged-in session: the access token plus
// the customer summary returned alongside it. Mirrors
// apps/dsm-app/src/storage/sessionStorage.ts's pattern, with a distinct key
// prefix so the two apps never collide if ever run against shared device
// storage in a dev/test harness.
//
// NOTE (open question, see customerAuthApi.ts header): the real backend
// session token shape/lifetime for customers is not yet decided. Whatever it
// ends up being, it must be a customer-scoped credential, never reusable
// against Staff-only endpoints.
const ACCESS_TOKEN_KEY = 'customerApp.accessToken';
const CUSTOMER_KEY = 'customerApp.customer';

export interface StoredCustomerSession {
  accessToken: string;
  customer: CustomerSummary;
}

export async function saveCustomerSession(session: StoredCustomerSession): Promise<void> {
  await AsyncStorage.multiSet([
    [ACCESS_TOKEN_KEY, session.accessToken],
    [CUSTOMER_KEY, JSON.stringify(session.customer)],
  ]);
}

export async function loadCustomerSession(): Promise<StoredCustomerSession | null> {
  const [[, accessToken], [, customerJson]] = await AsyncStorage.multiGet([
    ACCESS_TOKEN_KEY,
    CUSTOMER_KEY,
  ]);
  if (!accessToken || !customerJson) {
    return null;
  }
  try {
    return { accessToken, customer: JSON.parse(customerJson) as CustomerSummary };
  } catch {
    // Corrupted CUSTOMER_KEY (interrupted write, or a stale shape from an
    // older app version) — self-heal by wiping it, same reasoning as
    // apps/dsm-app/src/storage/sessionStorage.ts's loadSession().
    await clearCustomerSession();
    return null;
  }
}

export async function clearCustomerSession(): Promise<void> {
  await AsyncStorage.multiRemove([ACCESS_TOKEN_KEY, CUSTOMER_KEY]);
}
