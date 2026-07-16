import type { PaymentTypeTotals } from '../../api/types';
import { formatRupees } from '../../utils/format';

interface PaymentCollectionProps {
  totals: PaymentTypeTotals;
}

const ROWS: { key: keyof PaymentTypeTotals; label: string; color: string }[] = [
  { key: 'CASH', label: 'Cash', color: 'var(--green)' },
  { key: 'CARD', label: 'POS / card', color: 'var(--blue)' },
  { key: 'UPI', label: 'UPI', color: 'var(--purple)' },
  { key: 'CREDIT', label: 'Credit', color: 'var(--orange)' },
];

export function PaymentCollection({ totals }: PaymentCollectionProps) {
  const grandTotal = ROWS.reduce((sum, row) => sum + Math.max(0, totals[row.key]), 0) || 1;

  return (
    <div className="grid grid-4">
      {ROWS.map((row) => {
        const value = totals[row.key];
        const pct = Math.max(0, (value / grandTotal) * 100);
        return (
          <div className="card" key={row.key}>
            <div className="card-label">{row.label.toUpperCase()}</div>
            <div className="card-value">{formatRupees(value)}</div>
            <div className="bar-track">
              <div
                className="bar-fill"
                style={{ width: `${pct}%`, background: row.color }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
