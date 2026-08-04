import { apiFetch } from './client';
import type {
  CreateVoucherRequest,
  DayBookChronologicalReport,
  DayBookReport,
  PaymentModeLabel,
  TrialBalanceReport,
  VoucherListItem,
  VoucherType,
} from './types';

// POST /vouchers — manual voucher entry (Payment/Receipt/Contra/Journal),
// Section 12. Balance validation (sum(DEBIT) === sum(CREDIT)) is enforced
// server-side (VouchersService.create()) — see CreateVoucherRequest's own
// comment.
export function createVoucher(dto: CreateVoucherRequest): Promise<VoucherListItem> {
  return apiFetch<VoucherListItem>('/vouchers', {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

export function getVouchers(params?: {
  from?: string;
  to?: string;
  ledgerAccountId?: string;
}): Promise<VoucherListItem[]> {
  const qs = new URLSearchParams();
  if (params?.from) qs.set('from', params.from);
  if (params?.to) qs.set('to', params.to);
  if (params?.ledgerAccountId) qs.set('ledgerAccountId', params.ledgerAccountId);
  const suffix = qs.toString();
  return apiFetch<VoucherListItem[]>(`/vouchers${suffix ? `?${suffix}` : ''}`);
}

// Owner-only server-side, and only for source: 'MANUAL' vouchers — an
// auto-posted one must be corrected via its source record instead (see
// VouchersService.remove()).
export function deleteVoucher(id: string): Promise<{ deleted: true }> {
  return apiFetch<{ deleted: true }>(`/vouchers/${id}`, { method: 'DELETE' });
}

export interface DayBookQueryParams {
  date?: string;
  view?: 'ledger' | 'chronological';
  voucherType?: VoucherType;
  paymentMode?: PaymentModeLabel;
  partyLedgerAccountId?: string;
}

// GET /vouchers/day-book?date=YYYY-MM-DD — Section 12 / 12A Day Book.
// Omitted date -> today (server-local calendar day). Omitted/'ledger' view
// returns the per-ledger DayBookReport (unchanged); 'chronological' returns
// the shift-wise DayBookChronologicalReport — the filter params only take
// effect in that mode (see VouchersService.getDayBook()'s own comment).
export function getDayBook(
  params: DayBookQueryParams & { view: 'chronological' },
): Promise<DayBookChronologicalReport>;
export function getDayBook(params?: DayBookQueryParams & { view?: 'ledger' }): Promise<DayBookReport>;
// Catch-all for a dynamic (state-driven) `view` rather than a literal —
// same reason the backend's VouchersService.getDayBook() needs one.
export function getDayBook(
  params?: DayBookQueryParams,
): Promise<DayBookReport | DayBookChronologicalReport>;
export function getDayBook(
  params?: DayBookQueryParams,
): Promise<DayBookReport | DayBookChronologicalReport> {
  const qs = new URLSearchParams();
  if (params?.date) qs.set('date', params.date);
  if (params?.view) qs.set('view', params.view);
  if (params?.voucherType) qs.set('voucherType', params.voucherType);
  if (params?.paymentMode) qs.set('paymentMode', params.paymentMode);
  if (params?.partyLedgerAccountId) qs.set('partyLedgerAccountId', params.partyLedgerAccountId);
  const suffix = qs.toString();
  return apiFetch<DayBookReport | DayBookChronologicalReport>(
    `/vouchers/day-book${suffix ? `?${suffix}` : ''}`,
  );
}

// GET /vouchers/trial-balance?asOf=YYYY-MM-DD — Section 12 fix (finding #8):
// every active ledger's running balance as of a date, not just ledgers
// touched on one specific day like the Day Book. Omitted -> today.
export function getTrialBalance(asOf?: string): Promise<TrialBalanceReport> {
  const qs = asOf ? `?asOf=${encodeURIComponent(asOf)}` : '';
  return apiFetch<TrialBalanceReport>(`/vouchers/trial-balance${qs}`);
}
