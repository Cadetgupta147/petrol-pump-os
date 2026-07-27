import AsyncStorage from '@react-native-async-storage/async-storage';
import { createBill, BillsApiError, type CreateBillInput } from '../api/billsApi';

// Section 15.3/17.6 — DSM app offline queue. JUDGMENT CALL, flagged rather
// than silently substituted: docs/master-plan.md Section 15.3 recommends
// WatermelonDB (local SQLite) for this. WatermelonDB requires native
// SQLite bindings and a custom dev client build (it does NOT run in Expo
// Go, and this app is Expo-managed — see package.json, no
// expo-dev-client/EAS custom-build config exists) — adopting it would mean
// changing this project's whole build/tooling pipeline as a side effect of
// one feature slice, not something to pick silently. AsyncStorage (already
// a dependency — see storage/sessionStorage.ts) is JS-only, works
// unmodified in Expo Go, and a queue of pending bill submissions is a
// simple list, not relational data — it doesn't need SQLite's query
// capabilities. If the DSM app later adopts a custom dev client for other
// reasons, WatermelonDB remains the master-plan's recommendation and this
// module would be a reasonable thing to migrate off of at that point.
//
// SCOPE, per the existing code comments this queue closes out (see
// authApi.ts's pinLogin() and billsApi.ts's createBill()): only BILL ENTRY
// is queued. Login, meter readings, shift sales, and attendance all still
// require a live round trip — Section 15.3 describes offline support as
// applying "once a shift is underway" for bill entries specifically, not
// every DSM app action.
const QUEUE_KEY = 'dsmApp.offlineBillQueue';

export type QueuedBillStatus = 'pending' | 'failed';

export interface QueuedBill {
  clientRequestId: string;
  input: CreateBillInput;
  queuedAt: string;
  attempts: number;
  status: QueuedBillStatus;
  lastError?: string;
}

// Not a cryptographic UUID — doesn't need to be. Only needs to be unique
// enough that two queued bills never collide as the SAME idempotency key
// server-side (Bill.clientRequestId, scoped per-pump). Same
// timestamp+counter shape NewBillScreen.tsx's makeLocalId() already uses
// for payment-line local ids, extended with a random component since this
// id crosses app restarts (a plain in-memory counter would restart at 0).
let counter = 0;
function generateClientRequestId(): string {
  counter += 1;
  return `bill-${Date.now()}-${counter}-${Math.random().toString(36).slice(2, 10)}`;
}

async function readQueue(): Promise<QueuedBill[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as QueuedBill[];
  } catch {
    // Corrupted queue (interrupted write, stale shape from an older app
    // version) — same "wipe and move on" recovery as sessionStorage.ts's
    // loadSession(), rather than failing identically on every future call.
    await AsyncStorage.removeItem(QUEUE_KEY);
    return [];
  }
}

function writeQueue(queue: QueuedBill[]): Promise<void> {
  return AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

// Called by NewBillScreen when a live createBill() attempt fails with
// isNetworkError — stores the bill locally with a freshly minted
// clientRequestId (attached to `input` so every future sync attempt for
// this entry, including retries, replays the SAME id).
export async function enqueueBill(input: CreateBillInput): Promise<QueuedBill> {
  const queued: QueuedBill = {
    clientRequestId: generateClientRequestId(),
    input: { ...input, clientRequestId: undefined },
    queuedAt: new Date().toISOString(),
    attempts: 0,
    status: 'pending',
  };
  // clientRequestId lives on the QueuedBill record itself (the stable key);
  // stamped onto `input` fresh at each sync attempt in syncOfflineBills()
  // below, rather than duplicated into storage twice.
  const queue = await readQueue();
  queue.push(queued);
  await writeQueue(queue);
  return queued;
}

export function getQueuedBills(): Promise<QueuedBill[]> {
  return readQueue();
}

export async function getPendingCount(): Promise<number> {
  const queue = await readQueue();
  return queue.length;
}

// Attempts every queued bill in order (oldest first — same order the DSM
// entered them), sequentially rather than in parallel: a shaky connection
// that can barely sustain one request at a time shouldn't be hit with N
// concurrent retries, and preserving entry order matters for anyone
// reading the bill list afterward. A bill that syncs successfully
// (including a clientRequestId REPLAY that finds the original — see
// BillsService.create()'s comment) is removed from the queue. A bill that
// fails with isNetworkError stays queued unchanged (still worth retrying
// later). A bill REJECTED by a reachable server (isNetworkError: false —
// e.g. the vehicle got blacklisted, or credit limit enforcement changed,
// in the time since it was queued) is marked 'failed' with the server's
// message and left in the queue rather than silently dropped — the DSM/
// Owner needs to see it and decide what to do; nothing here ever discards
// a queued bill on its own.
export async function syncOfflineBills(
  accessToken: string,
): Promise<{ succeeded: number; failed: number; remaining: number }> {
  const queue = await readQueue();
  const remaining: QueuedBill[] = [];
  let succeeded = 0;
  let failed = 0;

  for (const entry of queue) {
    try {
      await createBill({ ...entry.input, clientRequestId: entry.clientRequestId }, accessToken);
      succeeded += 1;
    } catch (error) {
      const isNetworkError = error instanceof BillsApiError && error.isNetworkError;
      const message = error instanceof BillsApiError ? error.message : 'Something went wrong.';
      remaining.push({
        ...entry,
        attempts: entry.attempts + 1,
        status: isNetworkError ? 'pending' : 'failed',
        lastError: message,
      });
      failed += 1;
      if (isNetworkError) {
        // Still offline — no point attempting the rest of the queue this
        // pass, they'll all fail the same way. Keep everything after this
        // entry untouched (not even attempt-incremented) rather than
        // burning through the whole queue on one dead connection check.
        const remainingIndex = queue.indexOf(entry);
        remaining.push(...queue.slice(remainingIndex + 1));
        break;
      }
    }
  }

  await writeQueue(remaining);
  return { succeeded, failed, remaining: remaining.length };
}

// Owner/DSM-visible manual removal for a 'failed' (not 'pending') entry —
// e.g. the DSM re-entered the same sale manually after seeing the
// rejection and confirmed with the Owner that this queued copy should be
// discarded. Deliberately NOT exposed for 'pending' entries — those still
// deserve an automatic retry, not a manual "give up" button.
export async function discardFailedBill(clientRequestId: string): Promise<void> {
  const queue = await readQueue();
  const target = queue.find((entry) => entry.clientRequestId === clientRequestId);
  if (target && target.status !== 'failed') {
    throw new Error('Only a failed (rejected) queued bill can be discarded — a pending one still needs a retry.');
  }
  await writeQueue(queue.filter((entry) => entry.clientRequestId !== clientRequestId));
}
