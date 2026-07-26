import { useEffect, useState, type FormEvent } from 'react';
import { TopBar } from '../components/layout/TopBar';
import { NavBar } from '../components/layout/NavBar';
import { createExpense, getExpenses, deleteExpense } from '../api/expenses';
import { ApiError } from '../api/client';
import { useAuth } from '../context/useAuth';
import { formatRupees, formatDateTime, localIsoDate, isToday } from '../utils/format';
import type { CreateExpenseRequest, ExpenseEntry, PaymentType } from '../api/types';

const PAYMENT_TYPES: PaymentType[] = ['CASH', 'CARD', 'UPI', 'CREDIT'];

// Dashboard "Not wired to a backend endpoint yet" panel item #4 — Today's
// expenses. Owner/Accountant/Manager server-side (ExpensesController); a
// DSM/Read-only hitting this page just sees the backend's 403 in the
// error-box below, same pattern as PurchaseEntryPage. Delete is Owner-only
// server-side — the delete button is hidden for everyone else here too, but
// that's a convenience, not the enforcement (CLAUDE.md: never trust the
// frontend for permissions).
export function ExpensesPage() {
  const { staff } = useAuth();
  const isOwner = staff?.role === 'OWNER';

  const [entries, setEntries] = useState<ExpenseEntry[] | null>(null);
  const [entriesError, setEntriesError] = useState<string | null>(null);

  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [paidVia, setPaidVia] = useState<PaymentType>('CASH');
  const [expenseDate, setExpenseDate] = useState(localIsoDate());

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function load() {
    getExpenses()
      .then(setEntries)
      .catch((err) => {
        setEntriesError(err instanceof ApiError ? err.message : "Can't reach the backend.");
      });
  }

  useEffect(() => {
    load();
  }, []);

  function resetForm() {
    setCategory('');
    setDescription('');
    setAmount('');
    setPaidVia('CASH');
    setExpenseDate(localIsoDate());
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaveError(null);
    setSavedAt(null);
    setSaving(true);
    try {
      const dto: CreateExpenseRequest = {
        category: category.trim(),
        description: description.trim() === '' ? undefined : description.trim(),
        amount: Number(amount.trim()),
        paidVia,
        expenseDate,
      };
      const created = await createExpense(dto);
      setEntries((prev) => (prev ? [created, ...prev] : [created]));
      resetForm();
      setSavedAt(new Date().toLocaleTimeString());
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Can't reach the backend.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await deleteExpense(id);
      setEntries((prev) => (prev ? prev.filter((e) => e.id !== id) : prev));
    } catch (err) {
      setEntriesError(err instanceof ApiError ? err.message : "Can't reach the backend.");
    } finally {
      setDeletingId(null);
    }
  }

  const todaysTotal = (entries ?? [])
    .filter((e) => isToday(e.expenseDate))
    .reduce((sum, e) => sum + e.amount, 0);

  return (
    <>
      <TopBar />
      <NavBar />
      <div className="content">
        <div className="section-title">
          <h3>New expense</h3>
          <span className="section-note">POST /expenses</span>
        </div>

        <div className="section">
          <form onSubmit={(e) => { void handleSubmit(e); }}>
            <div className="grid grid-2">
              <div className="form-field">
                <label htmlFor="exp-category">Category</label>
                <input
                  id="exp-category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="e.g. Electricity, Staff snacks, Repairs"
                  required
                />
              </div>
              <div className="form-field">
                <label htmlFor="exp-amount">Amount (Rs.)</label>
                <input
                  id="exp-amount"
                  type="number"
                  min="0"
                  step="any"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                />
              </div>
              <div className="form-field">
                <label htmlFor="exp-paid-via">Paid via</label>
                <select
                  id="exp-paid-via"
                  value={paidVia}
                  onChange={(e) => setPaidVia(e.target.value as PaymentType)}
                >
                  {PAYMENT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label htmlFor="exp-date">Date</label>
                <input
                  id="exp-date"
                  type="date"
                  value={expenseDate}
                  onChange={(e) => setExpenseDate(e.target.value)}
                  required
                />
              </div>
              <div className="form-field" style={{ gridColumn: '1 / -1' }}>
                <label htmlFor="exp-description">Description</label>
                <input
                  id="exp-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional"
                />
              </div>
            </div>

            {saveError && <div className="form-error">{saveError}</div>}
            {savedAt && <div className="section-note">Saved at {savedAt}.</div>}

            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={resetForm} disabled={saving}>
                Clear form
              </button>
              <button type="submit" className="export-btn" disabled={saving}>
                {saving ? 'Saving…' : 'Save expense'}
              </button>
            </div>
          </form>
        </div>

        <div className="section">
          <div className="section-title">
            <h3>Expenses</h3>
            <span className="section-note">
              GET /expenses — most recent first · Today&rsquo;s total: {formatRupees(todaysTotal)}
            </span>
          </div>
          {entriesError && <div className="error-box">{entriesError}</div>}
          {!entriesError && !entries && <div className="loading">Loading expenses…</div>}
          {!entriesError && entries && entries.length === 0 && (
            <div className="empty-box">No expenses recorded yet.</div>
          )}
          {!entriesError && entries && entries.length > 0 && (
            <div className="table-card">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Description</th>
                    <th className="num">Amount</th>
                    <th>Paid via</th>
                    <th>Recorded at</th>
                    {isOwner && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id}>
                      <td>{entry.category}</td>
                      <td>{entry.description ?? '—'}</td>
                      <td className="num">{formatRupees(entry.amount)}</td>
                      <td>{entry.paidVia}</td>
                      <td>{formatDateTime(entry.expenseDate)}</td>
                      {isOwner && (
                        <td>
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => { void handleDelete(entry.id); }}
                            disabled={deletingId === entry.id}
                          >
                            {deletingId === entry.id ? 'Deleting…' : 'Delete'}
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
