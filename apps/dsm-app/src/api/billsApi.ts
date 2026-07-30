import { API_BASE_URL } from '../config';

// Mirrors apps/backend/src/bills/dto/create-bill.dto.ts and
// create-bill-payment-line.dto.ts exactly (Section 4 bill entry + Section 5A
// split payments). The server is the real authority on the balancing rule
// and the vehicle/customer-name rule — this file only carries data back and
// forth and surfaces the server's own error messages verbatim.
export type PaymentType = 'CASH' | 'CARD' | 'UPI' | 'CREDIT';
export type PaymentDirection = 'IN' | 'OUT';

export interface BillPaymentLineInput {
  paymentType: PaymentType;
  amount: number;
  direction: PaymentDirection;
}

export interface QuickAddCustomerInput {
  name: string;
  vehicleNumber: string;
}

export interface CreateBillInput {
  customerId?: string;
  quickAddCustomer?: QuickAddCustomerInput;
  vehicleNumber?: string;
  customerName?: string;
  amount: number;
  litres: number;
  productType: string;
  // Section 7.4 — rateApplied is deliberately NOT sent by the client. The
  // server resolves it authoritatively from Rate Master at creation time
  // (apps/backend/src/bills/dto/create-bill.dto.ts); the global
  // ValidationPipe has forbidNonWhitelisted on, so sending it here would
  // reject the whole request, not just be ignored.
  //
  // Finding A1 (docs/production-readiness.md) — enteredById is likewise NOT
  // sent by the client anymore. BillsController.create() now derives the
  // actor from the authenticated caller's JWT server-side; sending it here
  // would be rejected by the same forbidNonWhitelisted rule.
  entryChannel: 'DSM_APP';
  paymentLines: BillPaymentLineInput[];
  // Section 17.6 — offline queue idempotency key. Only set when this bill
  // is being submitted from offlineBillQueue.ts (either the first sync
  // attempt or a retry of the same queued entry) — see that file's comment.
  // Omitted for a normal live Save, same as every other entry point.
  clientRequestId?: string;
}

export interface BillPaymentLine {
  id: string;
  billId: string;
  paymentType: PaymentType;
  amount: number;
  direction: PaymentDirection;
}

export interface Bill {
  id: string;
  // Server-generated, human-friendly sequence (<PUMP_CODE>-<seq>, e.g.
  // "PUMP001-000123") — never client-supplied.
  billNumber: string;
  customerId: string | null;
  vehicleNumber: string | null;
  customerName: string | null;
  amount: number;
  litres: number;
  productType: string;
  rateApplied: number;
  enteredById: string;
  entryChannel: string;
  timestamp: string;
  // Section 6.3 step 5 — stamped on the bill at save time by the server.
  loyaltyPointsEarned: number;
  loyaltyBasisUsed: 'RUPEE' | 'LITRE' | null;
  paymentLines: BillPaymentLine[];
  // Present only when a customer-linked bill saved fine but earned nothing
  // because LoyaltyConfig isn't set (Section 17 open item) — shown as a
  // non-blocking banner after save, never an error.
  loyaltyWarning?: string;
}

// Thrown for both "server reachable but rejected the bill" (e.g. 400 —
// imbalanced payment lines, missing vehicle/customer name, credit limit
// exceeded under BLOCK mode — Section 3.4A) and "server unreachable". Per
// CLAUDE.md, anything touching bill amounts/points needs human review before
// merge — this client just relays what the server decided, it never guesses.
//
// Section 17.6 — isNetworkError distinguishes the two cases for
// NewBillScreen's offline-queue decision: a REJECTED bill (imbalanced
// payment, blacklisted vehicle, missing name/vehicle) must never be queued
// for silent retry — retrying an invalid payload without fixing it just
// wastes a sync attempt and hides a real problem from the DSM. Only an
// UNREACHABLE server is something retrying later can actually fix.
export class BillsApiError extends Error {
  constructor(message: string, public readonly isNetworkError: boolean = false) {
    super(message);
  }
}

const REQUEST_TIMEOUT_MS = 10_000;

export async function createBill(input: CreateBillInput, accessToken: string): Promise<Bill> {
  let response: Response;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    try {
      response = await fetch(`${API_BASE_URL}/bills`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(input),
        signal: controller.signal,
      });
    } catch {
      // Same network/timeout handling as authApi.ts. Section 17.6 —
      // NewBillScreen decides what to do with a network-unreachable failure
      // (queue it via offlineBillQueue.ts); this function's job stays
      // narrow — attempt the live call, report clearly whether the failure
      // was reachability or a real rejection.
      throw new BillsApiError(
        "Can't reach the server — check EXPO_PUBLIC_API_BASE_URL in your .env file.",
        true,
      );
    }
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    // Surface the backend's own `message` field verbatim — e.g. a
    // credit-limit-exceeded 400 or a payment-line-imbalance 400 should show
    // the server's actual message, not a generic client-invented one.
    let message = 'The server rejected this bill.';
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
    throw new BillsApiError(message);
  }

  return (await response.json()) as Bill;
}
