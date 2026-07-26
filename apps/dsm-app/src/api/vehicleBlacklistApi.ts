import { API_BASE_URL } from '../config';

// GET /vehicle-blacklist/check — Section 3.4B. Mirrors
// apps/backend/src/vehicle-blacklist/*, used here only for the DSM app's
// pre-check (see NewBillScreen's runBlacklistCheck). The AUTHORITATIVE block
// still happens server-side inside BillsService.create() via
// VehicleBlacklistService.assertNotBlacklisted() — this call is a
// convenience so the DSM finds out BEFORE filling out the whole bill, not
// the only safety net.
export interface VehicleBlacklistEntry {
  id: string;
  scope: 'VEHICLE' | 'COMPANY';
  vehicleNumber: string | null;
  companyName: string | null;
  reason: string;
  outstandingAmount: number;
  status: 'ACTIVE' | 'RESOLVED';
}

export interface BlacklistCheckResult {
  blocked: boolean;
  entry: VehicleBlacklistEntry | null;
}

export class VehicleBlacklistApiError extends Error {}

const REQUEST_TIMEOUT_MS = 10_000;

export async function checkVehicleBlacklist(
  params: { vehicleNumber?: string; customerId?: string },
  accessToken: string,
): Promise<BlacklistCheckResult> {
  const query = new URLSearchParams();
  if (params.vehicleNumber) query.set('vehicleNumber', params.vehicleNumber);
  if (params.customerId) query.set('customerId', params.customerId);

  let response: Response;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    try {
      response = await fetch(`${API_BASE_URL}/vehicle-blacklist/check?${query.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      });
    } catch {
      // Same network/timeout handling as the other api/ modules.
      throw new VehicleBlacklistApiError(
        "Can't reach the server — check EXPO_PUBLIC_API_BASE_URL in your .env file.",
      );
    }
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new VehicleBlacklistApiError('Could not check the vehicle blacklist.');
  }

  return (await response.json()) as BlacklistCheckResult;
}
