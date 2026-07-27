import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { TopBar } from '../components/layout/TopBar';
import { NavBar } from '../components/layout/NavBar';
import { getCustomerOutstandingStatement } from '../api/customers';
import { getBusinessProfile } from '../api/businessProfile';
import { ApiError } from '../api/client';
import { formatDateTime, formatRatePerLitre, formatRupees } from '../utils/format';
import type { BusinessProfile, OutstandingStatement } from '../api/types';

const OMC_LABEL: Record<BusinessProfile['omcBrand'], string> = {
  IOCL: 'Indian Oil (IOCL)',
  BPCL: 'Bharat Petroleum (BPCL)',
  HPCL: 'Hindustan Petroleum (HPCL)',
  OTHER: 'Authorized Dealer',
  NONE: '',
};

// Section 5B — Credit Customer Outstanding Statement. Printable via the
// browser's native print/"Save as PDF" (Section 5B.4) — no server-side PDF
// dependency, same reasoning as why the DSM app's own receipt (§4) only
// needed expo-print client-side.
export function CreditStatementPage() {
  const { id } = useParams<{ id: string }>();
  const [statement, setStatement] = useState<OutstandingStatement | null>(null);
  const [profile, setProfile] = useState<BusinessProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    Promise.all([getCustomerOutstandingStatement(id), getBusinessProfile()])
      .then(([statementResult, profileResult]) => {
        if (cancelled) return;
        setStatement(statementResult);
        setProfile(profileResult);
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
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .statement-sheet { box-shadow: none !important; border: none !important; margin: 0 !important; }
          body { background: #fff !important; }
        }
        .statement-sheet {
          background: #fff;
          border: 1px solid var(--border);
          border-radius: var(--radius);
          max-width: 800px;
          margin: 0 auto;
          padding: 36px 40px;
        }
        .statement-letterhead {
          display: flex;
          align-items: center;
          gap: 16px;
          border-bottom: 2px solid var(--navy);
          padding-bottom: 16px;
          margin-bottom: 20px;
        }
        .statement-logo { width: 56px; height: 56px; object-fit: contain; }
        .statement-title { font-size: 22px; font-weight: 800; color: var(--navy); }
        .statement-sub { font-size: 12.5px; color: var(--gray); margin-top: 2px; }
      `}</style>

      <div className="no-print">
        <TopBar />
        <NavBar />
      </div>

      <div className="content">
        <div className="no-print" style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Link to={id ? `/customers/${id}` : '/customers'} className="back-link">
            &lsaquo; Back to customer
          </Link>
          {statement && (
            <button type="button" className="export-btn" onClick={() => window.print()}>
              Print statement
            </button>
          )}
        </div>

        {error && <div className="error-box">{error}</div>}
        {!error && (!statement || !profile) && <div className="loading">Loading statement…</div>}

        {!error && statement && profile && (
          <div className="statement-sheet">
            {profile.useUploadedLetterhead && profile.letterheadImageData ? (
              <img
                src={profile.letterheadImageData}
                alt="Letterhead"
                style={{ width: '100%', display: 'block', marginBottom: 20 }}
              />
            ) : (
              <div className="statement-letterhead">
                {profile.logoImageData && (
                  <img src={profile.logoImageData} className="statement-logo" alt="Logo" />
                )}
                <div>
                  <div className="statement-title">{profile.businessName ?? 'Petrol Pump'}</div>
                  <div className="statement-sub">
                    {[profile.address, profile.phone && `Ph: ${profile.phone}`, profile.gstin && `GSTIN: ${profile.gstin}`]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                  {profile.omcBrand !== 'NONE' && (
                    <div className="statement-sub">{OMC_LABEL[profile.omcBrand]}</div>
                  )}
                </div>
              </div>
            )}

            <div className="section-title" style={{ marginBottom: 4 }}>
              <h3>Credit Outstanding Statement</h3>
              <span className="section-note">as of {formatDateTime(statement.asOf)}</span>
            </div>
            <div className="section-note" style={{ marginBottom: 20 }}>
              {statement.customer.name}
              {statement.customer.vehicleNumber && ` · ${statement.customer.vehicleNumber}`}
              {statement.customer.phone && ` · ${statement.customer.phone}`}
            </div>

            {statement.lines.length === 0 ? (
              <div className="empty-box">No outstanding balance — fully settled.</div>
            ) : (
              <div className="table-card">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Vehicle</th>
                      <th>Product</th>
                      <th className="num">Litres</th>
                      <th className="num">Rate</th>
                      <th className="num">Bill amount</th>
                      <th className="num">Outstanding</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statement.lines.map((line) =>
                      line.type === 'BILL' ? (
                        <tr key={`bill-${line.billId}`}>
                          <td>{formatDateTime(line.timestamp)}</td>
                          <td>{line.vehicleNumber ?? line.customerNameOnBill ?? '—'}</td>
                          <td>{line.productType}</td>
                          <td className="num">{line.litres.toFixed(2)} L</td>
                          <td className="num">{formatRatePerLitre(line.rateApplied)}</td>
                          <td className="num">{formatRupees(line.billAmount)}</td>
                          <td className="num">{formatRupees(line.outstandingAmount)}</td>
                        </tr>
                      ) : (
                        <tr key={`ob-${line.openingBalanceId}`}>
                          <td>{formatDateTime(line.timestamp)}</td>
                          <td colSpan={4} style={{ fontStyle: 'italic' }}>
                            Opening balance{line.note ? ` — ${line.note}` : ''}
                          </td>
                          <td className="num">{formatRupees(line.amount)}</td>
                          <td className="num">{formatRupees(line.outstandingAmount)}</td>
                        </tr>
                      ),
                    )}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={6} style={{ fontWeight: 700, textAlign: 'right' }}>
                        Total outstanding
                      </td>
                      <td className="num" style={{ fontWeight: 700 }}>
                        {formatRupees(statement.totalOutstanding)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            <div className="section-note" style={{ marginTop: 24, textAlign: 'center' }}>
              This is a system-generated statement. Printed {formatDateTime(new Date().toISOString())}.
            </div>
          </div>
        )}
      </div>
    </>
  );
}
