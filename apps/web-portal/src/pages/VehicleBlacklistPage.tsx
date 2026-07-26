import { useEffect, useState } from 'react';
import { TopBar } from '../components/layout/TopBar';
import { NavBar } from '../components/layout/NavBar';
import { VehicleBlacklistFormModal } from '../components/vehicleBlacklist/VehicleBlacklistFormModal';
import { ResolveVehicleBlacklistModal } from '../components/vehicleBlacklist/ResolveVehicleBlacklistModal';
import { getVehicleBlacklist } from '../api/vehicleBlacklist';
import { ApiError } from '../api/client';
import { useAuth } from '../context/useAuth';
import { formatDateTime, formatRupees } from '../utils/format';
import type { BlacklistStatus, VehicleBlacklistEntry } from '../api/types';

// Section 3.4B — dealer-initiated credit-recovery guard. Create/resolve are
// Owner-only server-side (@Roles(Role.OWNER) on vehicle-blacklist.controller.ts,
// same precedent as CreditSettingsPage/CreditConfigController); every other
// role that reaches this page gets a read-only list, same pattern
// CreditSettingsPage uses for its non-owner view.
export function VehicleBlacklistPage() {
  const { staff } = useAuth();
  const isOwner = staff?.role === 'OWNER';

  const [statusFilter, setStatusFilter] = useState<BlacklistStatus | 'ALL'>('ACTIVE');
  const [entries, setEntries] = useState<VehicleBlacklistEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [resolving, setResolving] = useState<VehicleBlacklistEntry | null>(null);

  function load(status: BlacklistStatus | 'ALL') {
    setEntries(null);
    getVehicleBlacklist(status === 'ALL' ? undefined : status)
      .then(setEntries)
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : "Can't reach the backend.");
      });
  }

  useEffect(() => {
    load(statusFilter);
  }, [statusFilter]);

  function handleSaved() {
    setAdding(false);
    load(statusFilter);
  }

  function handleResolved() {
    setResolving(null);
    load(statusFilter);
  }

  return (
    <>
      <TopBar />
      <NavBar />
      <div className="content">
        <div className="content-header">
          <div className="section-title">
            <h3>Vehicle/company blacklist</h3>
            <span className="section-note">
              Section 3.4B — blocks new CREDIT bills outright; cash/UPI/card are never affected
            </span>
          </div>
          {isOwner && (
            <button className="export-btn" onClick={() => setAdding(true)}>
              + Add entry
            </button>
          )}
        </div>

        <div className="date-tabs-group">
          <div className="date-tabs">
            {(['ACTIVE', 'RESOLVED', 'ALL'] as const).map((option) => (
              <button
                key={option}
                type="button"
                className={statusFilter === option ? 'date-tab active' : 'date-tab'}
                onClick={() => setStatusFilter(option)}
              >
                {option === 'ACTIVE' ? 'Active' : option === 'RESOLVED' ? 'Resolved' : 'All'}
              </button>
            ))}
          </div>
        </div>

        {!isOwner && (
          <div className="section-note">
            Only the Owner can add or resolve blacklist entries (Section 2) — this view is
            read-only for your role.
          </div>
        )}

        {error && <div className="error-box">{error}</div>}
        {!error && !entries && <div className="loading">Loading blacklist…</div>}
        {!error && entries && entries.length === 0 && (
          <div className="empty-box">No {statusFilter === 'ALL' ? '' : statusFilter.toLowerCase()} entries.</div>
        )}
        {!error && entries && entries.length > 0 && (
          <div className="table-card">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Reason</th>
                  <th className="num">Outstanding</th>
                  <th>Status</th>
                  <th>Blacklisted at</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.scope === 'VEHICLE' ? entry.vehicleNumber : entry.companyName}</td>
                    <td>{entry.reason}</td>
                    <td className="num">{formatRupees(entry.outstandingAmount)}</td>
                    <td>
                      <span
                        className="badge"
                        style={{
                          background: entry.status === 'ACTIVE' ? 'var(--red-bg)' : 'var(--green-bg)',
                          color: entry.status === 'ACTIVE' ? 'var(--red)' : 'var(--green)',
                        }}
                      >
                        {entry.status === 'ACTIVE' ? 'Active' : 'Resolved'}
                      </span>
                    </td>
                    <td>{formatDateTime(entry.blacklistedAt)}</td>
                    <td className="chevron">
                      {isOwner && entry.status === 'ACTIVE' && (
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => setResolving(entry)}
                        >
                          Resolve
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {adding && (
          <VehicleBlacklistFormModal onClose={() => setAdding(false)} onSaved={handleSaved} />
        )}
        {resolving && (
          <ResolveVehicleBlacklistModal
            entry={resolving}
            onClose={() => setResolving(null)}
            onResolved={handleResolved}
          />
        )}
      </div>
    </>
  );
}
