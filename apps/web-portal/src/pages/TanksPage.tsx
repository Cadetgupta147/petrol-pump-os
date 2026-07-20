import { useEffect, useState } from 'react';
import { TopBar } from '../components/layout/TopBar';
import { NavBar } from '../components/layout/NavBar';
import { getTanks } from '../api/tanks';
import { ApiError } from '../api/client';
import { formatLitres, formatDateTime } from '../utils/format';
import type { Tank } from '../api/types';

// Section 7.1 — read-only Tank Stock view: one row per Tank, current stock
// vs. capacity, last DIP reading, calibration chart reference. Tank
// creation/editing isn't part of this slice (POST/PATCH /tanks are unused
// here) — nothing in this codebase's UI creates a Tank row yet, matching
// TanksController's own comment that PurchaseEntry/DipReading both assume a
// Tank already exists.
//
// 45% fill-level threshold below is the same UI-only display judgment call
// as components/dashboard/StockPanel.tsx's REORDER_THRESHOLD_PCT — not a
// stored ReorderThreshold field on Tank, just mirrored here for a
// consistent bar color between the dashboard widget and this full page.
const LOW_STOCK_THRESHOLD_PCT = 45;

export function TanksPage() {
  const [tanks, setTanks] = useState<Tank[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getTanks()
      .then((result) => {
        if (!cancelled) setTanks(result);
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
          <h3>Tank stock</h3>
          <span className="section-note">GET /tanks — current levels (Section 7.1)</span>
        </div>

        {error && <div className="error-box">{error}</div>}
        {!error && !tanks && <div className="loading">Loading tanks…</div>}
        {!error && tanks && tanks.length === 0 && (
          <div className="empty-box">No tanks configured yet.</div>
        )}
        {!error && tanks && tanks.length > 0 && (
          <div className="table-card">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="num">Current stock / capacity</th>
                  <th>Fill level</th>
                  <th className="num">Last DIP reading</th>
                  <th>Last DIP at</th>
                  <th>Calibration chart ref</th>
                </tr>
              </thead>
              <tbody>
                {tanks.map((tank) => {
                  const pct =
                    tank.capacityLitres > 0
                      ? (tank.currentStockLitres / tank.capacityLitres) * 100
                      : 0;
                  const low = pct < LOW_STOCK_THRESHOLD_PCT;
                  return (
                    <tr key={tank.id}>
                      <td>{tank.productType}</td>
                      <td className="num">
                        {formatLitres(tank.currentStockLitres)} / {formatLitres(tank.capacityLitres)}
                      </td>
                      <td style={{ minWidth: 140 }}>
                        <div className="bar-track">
                          <div
                            className="bar-fill"
                            style={{
                              width: `${Math.min(100, Math.max(0, pct))}%`,
                              background: low ? 'var(--red)' : 'var(--green)',
                            }}
                          />
                        </div>
                      </td>
                      <td className="num">
                        {tank.lastDipReading !== null ? formatLitres(tank.lastDipReading) : '—'}
                      </td>
                      <td>{tank.lastDipAt ? formatDateTime(tank.lastDipAt) : 'no DIP reading yet'}</td>
                      <td>{tank.calibrationChartRef ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
