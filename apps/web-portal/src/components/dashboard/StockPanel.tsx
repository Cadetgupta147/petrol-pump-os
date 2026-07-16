import type { TankStock } from '../../api/types';
import { formatLitres, formatSignedLitres } from '../../utils/format';

interface StockPanelProps {
  tanks: TankStock[];
}

// Reorder threshold is a UI-only judgment call (45% of capacity) — there is
// no ReorderThreshold field on Tank in the schema, so this isn't read from
// anywhere real; it just mirrors the number used in the earlier mockups.
const REORDER_THRESHOLD_PCT = 45;
// Same story: no VarianceTolerance field on Tank. This threshold is a
// display convenience, not a configured business rule like CreditConfig is.
const VARIANCE_OK_LITRES = 100;

export function StockPanel({ tanks }: StockPanelProps) {
  if (tanks.length === 0) {
    return <div className="card-sub">No tanks recorded yet.</div>;
  }

  return (
    <div className="card">
      <h3 style={{ fontSize: 13, marginBottom: 4 }}>Stock levels</h3>
      {tanks.map((tank) => {
        const pct = tank.capacityLitres > 0
          ? (tank.currentStockLitres / tank.capacityLitres) * 100
          : 0;
        const hasDip = tank.lastDipReading !== null;
        const variance = hasDip ? tank.lastDipReading! - tank.currentStockLitres : null;
        const varianceOk = variance === null || Math.abs(variance) <= VARIANCE_OK_LITRES;
        const belowReorder = pct < REORDER_THRESHOLD_PCT;
        const barColor = belowReorder || !varianceOk ? 'var(--red)' : 'var(--green)';

        return (
          <div className="stock-row" key={tank.id}>
            <div className="stock-row-head">
              <span>{tank.productType}</span>
              <span style={{ color: 'var(--gray)', fontSize: 11 }}>
                system {formatLitres(tank.currentStockLitres)}
                {' / '}
                {hasDip ? `DIP ${formatLitres(tank.lastDipReading!)}` : 'no DIP recorded'}
              </span>
            </div>
            <div className="bar-track">
              <div
                className="bar-fill"
                style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: barColor }}
              />
            </div>
            {hasDip && (
              <div
                className="stock-variance"
                style={{ color: varianceOk ? 'var(--green)' : 'var(--red)' }}
              >
                variance {formatSignedLitres(variance!)}
                {varianceOk ? ' (within tolerance)' : ' — check tank'}
              </div>
            )}
            {belowReorder && (
              <div style={{ fontSize: 10, color: 'var(--red)', marginTop: 4 }}>
                Below {REORDER_THRESHOLD_PCT}% reorder threshold (display-only judgment call — not a stored setting)
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
