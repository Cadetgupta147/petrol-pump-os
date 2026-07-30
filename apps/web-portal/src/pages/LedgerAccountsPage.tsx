import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { TopBar } from '../components/layout/TopBar';
import { NavBar } from '../components/layout/NavBar';
import {
  createLedgerAccount,
  deleteLedgerAccount,
  getLedgerAccounts,
} from '../api/ledgerAccounts';
import { ApiError } from '../api/client';
import { useAuth } from '../context/useAuth';
import { formatRupees } from '../utils/format';
import type { LedgerAccount, LedgerGroup } from '../api/types';

const GROUPS: LedgerGroup[] = [
  'CASH_IN_HAND',
  'BANK',
  'SALES',
  'PURCHASE',
  'SUNDRY_DEBTOR',
  'SUNDRY_CREDITOR',
  'DIRECT_EXPENSE',
  'INDIRECT_EXPENSE',
  'CAPITAL_ACCOUNT',
  'OTHER',
];

function groupLabel(group: LedgerGroup): string {
  return group
    .split('_')
    .map((w) => w[0] + w.slice(1).toLowerCase())
    .join(' ');
}

// Ledger Master (Section 12 Day Book) — dealer-created account heads
// ("BABU JI", "JEEP 0711", "TOLL", "STATE BANK OF INDIA"-style entries).
// System-managed ledgers (Cash, Sales, Card, UPI, Bank, and lazily-created
// per-customer/per-staff ledgers — see LedgerPostingService) show up here
// too, read-only except for their opening balance, since they're what
// auto-posting depends on existing.
export function LedgerAccountsPage() {
  const { staff } = useAuth();
  const canEdit =
    staff?.role === 'OWNER' || staff?.role === 'ACCOUNTANT' || staff?.role === 'MANAGER';
  const canDelete = staff?.role === 'OWNER';

  const [accounts, setAccounts] = useState<LedgerAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [group, setGroup] = useState<LedgerGroup>('OTHER');
  const [openingBalance, setOpeningBalance] = useState('0');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function load(): Promise<void> {
    return getLedgerAccounts().then(setAccounts);
  }

  useEffect(() => {
    let cancelled = false;
    load().catch((err) => {
      if (!cancelled) {
        setError(err instanceof ApiError ? err.message : "Can't reach the backend.");
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaveError(null);
    setSaving(true);
    try {
      await createLedgerAccount({
        name: name.trim(),
        group,
        openingBalance: Number(openingBalance.trim() || '0'),
        openingBalanceType: 'DEBIT',
      });
      setName('');
      setGroup('OTHER');
      setOpeningBalance('0');
      await load();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Can't reach the backend.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeleteError(null);
    setDeletingId(id);
    try {
      await deleteLedgerAccount(id);
      await load();
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : "Can't reach the backend.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <TopBar />
      <NavBar />
      <div className="content">
        <div className="content-header">
          <div className="section-title">
            <h3>Ledger Master</h3>
            <span className="section-note">
              GET/POST /ledger-accounts — account heads for the Day Book (Section 12)
            </span>
          </div>
          <div className="content-header-right">
            <Link to="/vouchers" className="btn-secondary">
              Voucher entry &rsaquo;
            </Link>
            <Link to="/day-book" className="btn-secondary">
              Day book &rsaquo;
            </Link>
          </div>
        </div>

        {error && <div className="error-box">{error}</div>}
        {!error && !accounts && <div className="loading">Loading ledger accounts…</div>}

        {!error && accounts && (
          <>
            <div className="section">
              {accounts.length === 0 ? (
                <div className="empty-box">No ledger accounts yet.</div>
              ) : (
                <div className="table-card">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Group</th>
                        <th className="num">Opening balance</th>
                        <th>Type</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {accounts.map((account) => (
                        <tr key={account.id}>
                          <td>{account.name}</td>
                          <td>{groupLabel(account.group)}</td>
                          <td className="num">{formatRupees(account.openingBalance)}</td>
                          <td>
                            {account.isSystemManaged ? (
                              <span className="badge">System</span>
                            ) : (
                              'Dealer-created'
                            )}
                          </td>
                          <td>
                            {canDelete && !account.isSystemManaged && (
                              <button
                                type="button"
                                className="card-sub clickable"
                                disabled={deletingId === account.id}
                                onClick={() => {
                                  void handleDelete(account.id);
                                }}
                              >
                                {deletingId === account.id ? 'Deleting…' : 'Delete'}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {deleteError && <div className="form-error">{deleteError}</div>}
            </div>

            {canEdit ? (
              <form className="section" onSubmit={(e) => { void handleSubmit(e); }}>
                <div className="section-title">
                  <h3>Add ledger account</h3>
                  <span className="section-note">e.g. a credit party, a personal-draw head, an expense category</span>
                </div>
                <div className="grid grid-3">
                  <div className="form-field">
                    <label htmlFor="la-name">Name</label>
                    <input
                      id="la-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Babu Ji"
                      required
                    />
                  </div>
                  <div className="form-field">
                    <label htmlFor="la-group">Group</label>
                    <select
                      id="la-group"
                      value={group}
                      onChange={(e) => setGroup(e.target.value as LedgerGroup)}
                    >
                      {GROUPS.map((g) => (
                        <option key={g} value={g}>
                          {groupLabel(g)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-field">
                    <label htmlFor="la-opening">Opening balance (Rs., Dr)</label>
                    <input
                      id="la-opening"
                      type="number"
                      step="0.01"
                      value={openingBalance}
                      onChange={(e) => setOpeningBalance(e.target.value)}
                    />
                  </div>
                </div>

                {saveError && <div className="form-error">{saveError}</div>}

                <div className="modal-actions">
                  <button type="submit" className="export-btn" disabled={saving}>
                    {saving ? 'Saving…' : 'Add ledger account'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="section-note">
                Only Owner/Accountant/Manager can add or edit ledger accounts (Section 2) — this
                view is read-only for your role.
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
