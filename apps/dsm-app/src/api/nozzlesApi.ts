import { API_BASE_URL } from '../config';

// Mirrors the backend contract exactly (apps/backend/src/nozzles/*, Section
// 3.3/4 Nozzle master). This is what powers the Meter Reading screen's
// nozzle picker — a DSM chooses from this list, never types a nozzle id.
// nextOpeningReading is server-computed on every read (the carry-forward
// rule's result: the nozzle's last closed shift's closingReading, or its
// configured startingReading if it's never had one) — shown as a read-only
// preview, never an editable field anywhere in this app. rolloverAt is null
// unless this nozzle's physical meter is configured (Settings, web portal)
// to roll over to zero at a fixed digit count — see meterReadingsApi.ts's
// CloseShiftParams.meterRolledOver.
export interface Nozzle {
  id: string;
  label: string;
  itemId: string;
  item: { id: string; name: string; category: string; unit: string };
  startingReading: number;
  rolloverAt: number | null;
  isActive: boolean;
  nextOpeningReading: number;
}

export class NozzlesApiError extends Error {}

const REQUEST_TIMEOUT_MS = 10_000;

// GET /nozzles — active nozzles only, dealer-configured under Settings on
// the web portal (Owner/Accountant). DSM is allowed to read this list (not
// write it) — see nozzles.controller.ts.
export async function listNozzles(accessToken: string): Promise<Nozzle[]> {
  let response: Response;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    try {
      response = await fetch(`${API_BASE_URL}/nozzles`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      });
    } catch {
      // Same network/timeout handling as meterReadingsApi.ts /
      // customersApi.ts — fetch() throws on network failure or the
      // AbortController firing after REQUEST_TIMEOUT_MS, both treated as
      // "couldn't reach the server".
      throw new NozzlesApiError(
        "Can't reach the server — check EXPO_PUBLIC_API_BASE_URL in your .env file.",
      );
    }
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    let message = 'Could not load nozzles.';
    try {
      const body = (await response.json()) as { message?: string | string[] };
      if (typeof body.message === 'string' && body.message.length > 0) {
        message = body.message;
      } else if (Array.isArray(body.message) && body.message.length > 0) {
        message = body.message.join(', ');
      }
    } catch {
      // Body wasn't valid JSON — fall back to the generic message above.
    }
    throw new NozzlesApiError(message);
  }

  return (await response.json()) as Nozzle[];
}
