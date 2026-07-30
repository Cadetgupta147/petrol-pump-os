import { apiFetch } from './client';
import type {
  CreateLedgerAccountRequest,
  LedgerAccount,
  UpdateLedgerAccountRequest,
} from './types';

// Ledger Master (Section 12) — Owner/Accountant create/edit; Manager/
// Read-only view only (LedgerAccountsController).
export function createLedgerAccount(dto: CreateLedgerAccountRequest): Promise<LedgerAccount> {
  return apiFetch<LedgerAccount>('/ledger-accounts', {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

export function getLedgerAccounts(): Promise<LedgerAccount[]> {
  return apiFetch<LedgerAccount[]>('/ledger-accounts');
}

export function updateLedgerAccount(
  id: string,
  dto: UpdateLedgerAccountRequest,
): Promise<LedgerAccount> {
  return apiFetch<LedgerAccount>(`/ledger-accounts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
  });
}

// Owner-only server-side. Soft-deletes (isActive: false) — blocked with a
// 400 if the ledger is system-managed or already has voucher lines against
// it (see LedgerAccountsService.remove()).
export function deleteLedgerAccount(id: string): Promise<LedgerAccount> {
  return apiFetch<LedgerAccount>(`/ledger-accounts/${id}`, { method: 'DELETE' });
}
