import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { TopBar } from '../components/layout/TopBar';
import { NavBar } from '../components/layout/NavBar';
import { BillFormModal } from '../components/bills/BillFormModal';
import { DeleteBillConfirmModal } from '../components/bills/DeleteBillConfirmModal';
import { getBill } from '../api/bills';
import { ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { formatRupees, formatDateTime } from '../utils/format';
import type { Bill } from '../api/types';

export function BillDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { staff } = useAuth();
  const [bill, setBill] = useState<Bill | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Client-side gating here is UX only, not enforcement — the real
  // restriction is server-side (BillsController: PATCH stays class-level
  // Owner/Accountant, DELETE carries a method-level @Roles(Role.OWNER)
  // override, per the Section 3.2 deviation documented on remove()).
  const canEdit = staff?.role === 'OWNER' || staff?.role === 'ACCOUNTANT';
  const canDelete = staff?.role === 'OWNER';

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    getBill(id)
      .then((result) => {
        if (!cancelled) setBill(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Can't reach the backend.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // After a successful PATCH, re-fetch rather than reconstruct the Bill from
  // just the form fields — same pattern CustomersPage uses, keeps this in
  // sync with server-side fields the form doesn't touch (lastEditedById,
  // lastEditedAt, etc.).
  function handleSaved() {
    setEditing(false);
    if (!id) return;
    getBill(id)
      .then(setBill)
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : "Can't reach the backend.");
      });
  }

  function handleDeleted() {
    setConfirmingDelete(false);
    if (!id) return;
    getBill(id)
      .then(setBill)
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : "Can't reach the backend.");
      });
  }

  return (
    <>
      <TopBar />
      <NavBar />
      <div className="content">
        <Link to="/dashboard" className="back-link">
          &lsaquo; Back to dashboard
        </Link>

        {error && <div className="error-box">{error}</div>}
        {!error && !bill && <div className="loading">Loading bill…</div>}

        {!error && bill && (
          <>
            <div className="content-header">
              <div className="section-title">
                <h3>{bill.customerName ?? bill.vehicleNumber ?? 'Walk-in bill'}</h3>
                <span className="section-note">{formatDateTime(bill.timestamp)} &middot; entered via {bill.entryChannel === 'DSM_APP' ? 'DSM app' : 'web'}</span>
              </div>
              {!bill.deletedAt && (canEdit || canDelete) && (
                <div className="content-header-right">
                  {canEdit && (
                    <button type="button" className="btn-secondary" onClick={() => setEditing(true)}>
                      Edit
                    </button>
                  )}
                  {canDelete && (
                    <button type="button" className="btn-secondary" onClick={() => setConfirmingDelete(true)}>
                      Delete
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="section">
              <div className="grid grid-3">
                <div className="card">
                  <div className="card-label">AMOUNT</div>
                  <div className="card-value">{formatRupees(bill.amount)}</div>
                </div>
                <div className="card">
                  <div className="card-label">LITRES</div>
                  <div className="card-value">{bill.litres.toFixed(2)} L</div>
                  <div className="card-sub">{bill.productType} &middot; rate {formatRupees(bill.rateApplied)}/L</div>
                </div>
                <div className="card">
                  <div className="card-label">VEHICLE</div>
                  <div className="card-value" style={{ fontSize: 16 }}>{bill.vehicleNumber ?? '—'}</div>
                </div>
              </div>
            </div>

            <div className="section">
              <div className="section-title">
                <h3>Payment lines</h3>
                <span className="section-note">sum(IN) − sum(OUT) must equal the bill amount</span>
              </div>
              <div className="table-card">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Direction</th>
                      <th className="num">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bill.paymentLines.map((line) => (
                      <tr key={line.id}>
                        <td>{line.paymentType === 'CARD' ? 'POS / card' : line.paymentType[0] + line.paymentType.slice(1).toLowerCase()}</td>
                        <td>{line.direction === 'IN' ? 'Received' : 'Change given'}</td>
                        <td className="num">{formatRupees(line.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {bill.deletedAt && (
              <div className="banner">This bill was soft-deleted on {formatDateTime(bill.deletedAt)}.</div>
            )}

            {editing && staff && (
              <BillFormModal
                bill={bill}
                editedById={staff.id}
                onClose={() => setEditing(false)}
                onSaved={handleSaved}
              />
            )}
            {confirmingDelete && staff && (
              <DeleteBillConfirmModal
                bill={bill}
                deletedById={staff.id}
                onClose={() => setConfirmingDelete(false)}
                onDeleted={handleDeleted}
              />
            )}
          </>
        )}
      </div>
    </>
  );
}
