import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '../components/layout/TopBar';
import { NavBar } from '../components/layout/NavBar';
import { getAllCustomers } from '../api/customers';
import { ApiError } from '../api/client';
import { formatRupees } from '../utils/format';
import type { Customer } from '../api/types';

// This is the real click-through destination for the dashboard's credit
// limit alerts — "N customers over credit limit" lands here, per the
// audit-trail spirit of docs/master-plan.md (every number should lead
// somewhere real, not just be a static count).
export function CustomersPage() {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAllCustomers()
      .then((result) => {
        if (!cancelled) setCustomers(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Can't reach the backend.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <TopBar />
      <NavBar />
      <div className="content">
        <div className="section-title">
          <h3>Credit customers</h3>
          <span className="section-note">GET /customers — click a row for the full ledger</span>
        </div>

        {error && <div className="error-box">{error}</div>}
        {!error && !customers && <div className="loading">Loading customers…</div>}
        {!error && customers && customers.length === 0 && (
          <div className="empty-box">No customers recorded yet.</div>
        )}
        {!error && customers && customers.length > 0 && (
          <div className="table-card">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Vehicle</th>
                  <th>Status</th>
                  <th className="num">Credit limit</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {customers.map((customer) => (
                  <tr
                    key={customer.id}
                    className="clickable-row"
                    onClick={() => navigate(`/customers/${customer.id}`)}
                  >
                    <td>{customer.name}</td>
                    <td>{customer.phone ?? '—'}</td>
                    <td>{customer.vehicleNumber ?? '—'}</td>
                    <td>
                      <span
                        className="badge"
                        style={{
                          background: customer.verificationStatus === 'VERIFIED' ? 'var(--green-bg)' : 'var(--amber-bg)',
                          color: customer.verificationStatus === 'VERIFIED' ? 'var(--green)' : 'var(--amber)',
                        }}
                      >
                        {customer.verificationStatus === 'VERIFIED' ? 'Verified' : 'Informal'}
                      </span>
                    </td>
                    <td className="num">{formatRupees(customer.creditLimit)}</td>
                    <td className="chevron">&rsaquo;</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
