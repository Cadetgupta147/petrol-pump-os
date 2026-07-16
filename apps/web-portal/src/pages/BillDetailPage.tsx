import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { TopBar } from '../components/layout/TopBar';
import { NavBar } from '../components/layout/NavBar';
import { getBill } from '../api/bills';
import { ApiError } from '../api/client';
import { formatRupees, formatDateTime } from '../utils/format';
import type { Bill } from '../api/types';

export function BillDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [bill, setBill] = useState<Bill | null>(null);
  const [error, setError] = useState<string | null>(null);

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
            <div className="section-title">
              <h3>{bill.customerName ?? bill.vehicleNumber ?? 'Walk-in bill'}</h3>
              <span className="section-note">{formatDateTime(bill.timestamp)} &middot; entered via {bill.entryChannel === 'DSM_APP' ? 'DSM app' : 'web'}</span>
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
          </>
        )}
      </div>
    </>
  );
}
