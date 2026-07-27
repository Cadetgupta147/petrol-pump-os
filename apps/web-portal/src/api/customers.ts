import { apiFetch } from './client';
import type {
  Customer,
  CustomerLedger,
  CustomerQrCard,
  CustomerDataExport,
  CreateCustomerRequest,
  UpdateCustomerRequest,
  CustomerOpeningBalance,
  CreateOpeningBalanceRequest,
} from './types';

export function getAllCustomers(): Promise<Customer[]> {
  return apiFetch<Customer[]>('/customers');
}

// GET /customers/:id deliberately isn't wired up here. Every place in this
// app that needs a single customer already has the full Customer object in
// hand — CustomersPage's list from getAllCustomers(), or the embedded
// ledger.customer from getCustomerLedger() below — so a standalone
// single-customer fetch would only ever be a redundant duplicate request.
// If a future screen needs to load one customer in isolation (e.g. a
// deep-linked edit page), add it back then.

// POST /customers — Section 3.4 create. Owner/Accountant only server-side
// (CustomersController has no @Roles override on `create`, unlike
// `findAll`, which also allows DSM). Always creates a VERIFIED customer —
// verificationStatus isn't settable on create, only via the PATCH upgrade
// path below (Section 3.4A).
export function createCustomer(dto: CreateCustomerRequest): Promise<Customer> {
  return apiFetch<Customer>('/customers', {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

// PATCH /customers/:id — any subset of name/phone/vehicleNumber/creditLimit,
// plus verificationStatus for the informal -> verified upgrade (Section
// 3.4A). Owner/Accountant only, same as create.
export function updateCustomer(id: string, dto: UpdateCustomerRequest): Promise<Customer> {
  return apiFetch<Customer>(`/customers/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
  });
}

// GET /customers/:id/ledger — every bill + payment for this customer in
// chronological order, with a running balance (CustomersService.ledger()).
// This is the real "click into the detail" destination for a credit alert
// or an overdue-customer count on the dashboard.
export function getCustomerLedger(id: string): Promise<CustomerLedger> {
  return apiFetch<CustomerLedger>(`/customers/${id}/ledger`);
}

// GET /customers/:id/qr — Section 6.1. The QR encodes ONLY the member id (a
// pointer, not a wallet) — the PNG is for on-screen display, the SVG for
// printing the physical card (Section 6.7). Owner/Accountant server-side.
export function getCustomerQrCard(id: string): Promise<CustomerQrCard> {
  return apiFetch<CustomerQrCard>(`/customers/${id}/qr`);
}

// PATCH /customers/:id/loyalty-rate-override — Section 6.2 rate precedence
// step 1. Owner-ONLY server-side (a per-customer override is a loyalty
// rate, which Section 2 bars Accountant from changing). null clears the
// override back to the dealer default; 0 is a real "earns nothing" override.
export function setLoyaltyRateOverride(
  id: string,
  loyaltyRateOverride: number | null,
): Promise<Customer> {
  return apiFetch<Customer>(`/customers/${id}/loyalty-rate-override`, {
    method: 'PATCH',
    body: JSON.stringify({ loyaltyRateOverride }),
  });
}

// PATCH /customers/:id/consent — Section 17.11 (DPDP Act compliance
// scaffolding). Owner/Accountant server-side.
export function recordCustomerConsent(id: string, version: string): Promise<Customer> {
  return apiFetch<Customer>(`/customers/${id}/consent`, {
    method: 'PATCH',
    body: JSON.stringify({ version }),
  });
}

// GET /customers/:id/data-export — right to access. Owner/Accountant
// server-side. The page builds a downloadable JSON file from this directly
// (no separate file-download endpoint needed, unlike Tally's XML export).
export function exportCustomerData(id: string): Promise<CustomerDataExport> {
  return apiFetch<CustomerDataExport>(`/customers/${id}/data-export`);
}

// POST /customers/:id/data-deletion — right to erasure. Owner-ONLY
// server-side; irreversible (anonymizes, doesn't hard-delete — see
// CustomersService.requestDeletion()'s comment for the per-pump-membership
// scope limitation).
export function requestCustomerDeletion(id: string): Promise<Customer> {
  return apiFetch<Customer>(`/customers/${id}/data-deletion`, { method: 'POST' });
}

// POST /customers/:id/opening-balance — Section 3.4, onboarding an existing
// (pre-system) credit customer with a real balance from before this pump
// used the software. Owner/Accountant server-side (class-level @Roles on
// CustomersController). Human-review flag (CLAUDE.md): this writes directly
// to a customer's credit balance.
export function addCustomerOpeningBalance(
  id: string,
  dto: CreateOpeningBalanceRequest,
): Promise<CustomerOpeningBalance> {
  return apiFetch<CustomerOpeningBalance>(`/customers/${id}/opening-balance`, {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}
