import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { TopBar } from '../components/layout/TopBar';
import { NavBar } from '../components/layout/NavBar';
import { getCustomerLedger } from '../api/customers';
import { ApiError } from '../api/client';
import { formatRupees, formatDateTime } from '../utils/format';
import type { CustomerLedger } from '../api/types';

export function CustomerLedgerPage() {
  const { id } = useParams<{ id: string }>();
  const [ledger, setLedger] = useState<CustomerLedger | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    getCustomerLedger(id)
      .then((result) => {
        if (!cancelled) setLedger(result);
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

  return (
    <>
      <TopBar />
      <NavBar />
      <div className="content">
        <Link to="/customers" className="back-link">
          &lsaquo; Back to customers
        </Link>

        {error && <div className="error-box">{error}</div>}
        {!error && !ledger && <div className="loading">Loading ledger…</div>}

        {!error && ledger && (
          <>
            <div className="section-title">
              <h3>{ledger.customer.name}</h3>
              <span className="section-note">
                {ledger.customer.verificationStatus === 'VERIFIED' ? 'Verified' : 'Informal'} &middot;{' '}
                {ledger.customer.vehicleNumber ?? 'no vehicle on file'} &middot; {ledger.customer.phone ?? 'no phone on file'}
              </span>
            </div>

            <div className="section">
              <div className="grid grid-2">
                <div
                  className="card"
                  style={
                    ledger.outstandingBalance > ledger.creditLimit
                      ? { background: 'var(--red-bg)', borderColor: '#f3c9c9' }
                      : undefined
                  }
                >
                  <div className="card-label">OUTSTANDING BALANCE</div>
                  <div
                    className="card-value"
                    style={{ color: ledger.outstandingBalance > ledger.creditLimit ? 'var(--red)' : undefined }}
                  >
                    {formatRupees(ledger.outstandingBalance)}
                  </div>
                  {ledger.outstandingBalance > ledger.creditLimit && (
                    <div className="card-sub" style={{ color: 'var(--red)' }}>
                      over the {formatRupees(ledger.creditLimit)} limit
                    </div>
                  )}
                </div>
                <div className="card">
                  <div className="card-label">CREDIT LIMIT</div>
                  <div className="card-value">{formatRupees(ledger.creditLimit)}</div>
                </div>
              </div>
            </div>

            <div className="section">
              <div className="section-title">
                <h3>Ledger</h3>
                <span className="section-note">every bill and payment, oldest first, running balance</span>
              </div>
              {ledger.entries.length === 0 ? (
                <div className="empty-box">No bills or payments recorded for this customer yet.</div>
              ) : (
                <div className="table-card">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Type</th>
                        <th className="num">Net credit impact</th>
                        <th className="num">Running balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledger.entries.map((entry) => (
                        <tr key={`${entry.type}-${entry.id}`}>
                          <td>{formatDateTime(entry.timestamp)}</td>
                          <td>
                            <span
                              className="badge"
                              style={{
                                background: entry.type === 'BILL' ? 'var(--amber-bg)' : 'var(--green-bg)',
                                color: entry.type === 'BILL' ? 'var(--amber)' : 'var(--green)',
                              }}
                            >
                              {entry.type === 'BILL' ? 'Bill' : 'Payment'}
                            </span>
                          </td>
                          <td className="num">
                            {entry.netCreditImpact > 0 ? '+' : ''}
                            {formatRupees(entry.netCreditImpact)}
                          </td>
                          <td className="num">{formatRupees(entry.runningBalance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
