import { apiFetch } from './client';
import type { CreateVoucherRequest, DayBookReport, TrialBalanceReport, VoucherListItem } from './types';

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

// GET /vouchers/day-book?date=YYYY-MM-DD — Section 12 Day Book. Omitted ->
// today (server-local calendar day).
export function getDayBook(date?: string): Promise<DayBookReport> {
  const qs = date ? `?date=${encodeURIComponent(date)}` : '';
  return apiFetch<DayBookReport>(`/vouchers/day-book${qs}`);
}

// GET /vouchers/trial-balance?asOf=YYYY-MM-DD — Section 12 fix (finding #8):
// every active ledger's running balance as of a date, not just ledgers
// touched on one specific day like the Day Book. Omitted -> today.
export function getTrialBalance(asOf?: string): Promise<TrialBalanceReport> {
  const qs = asOf ? `?asOf=${encodeURIComponent(asOf)}` : '';
  return apiFetch<TrialBalanceReport>(`/vouchers/trial-balance${qs}`);
}
