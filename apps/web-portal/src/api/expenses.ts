import { apiFetch } from './client';
import type { CreateExpenseRequest, ExpenseEntry } from './types';

// POST /expenses — dashboard "Today's expenses" slice. Owner/Accountant/
// Manager only server-side.
export function createExpense(dto: CreateExpenseRequest): Promise<ExpenseEntry> {
  return apiFetch<ExpenseEntry>('/expenses', {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

// GET /expenses?from=&to= — both independently optional.
export function getExpenses(range?: { from?: string; to?: string }): Promise<ExpenseEntry[]> {
  const params = new URLSearchParams();
  if (range?.from) params.set('from', range.from);
  if (range?.to) params.set('to', range.to);
  const query = params.toString();
  return apiFetch<ExpenseEntry[]>(`/expenses${query ? `?${query}` : ''}`);
}

// DELETE /expenses/:id — Owner-only server-side.
export function deleteExpense(id: string): Promise<void> {
  return apiFetch<void>(`/expenses/${id}`, { method: 'DELETE' });
}
