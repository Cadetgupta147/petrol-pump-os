import { useMemo } from 'react';
import { StatusBadge } from '../common/StatusBadge';
import type { MeterReading, MeterVariance } from '../../api/types';
import { formatLitres, formatSignedLitres, formatTime, localIsoDate } from '../../utils/format';

interface NozzleReadingsTableProps {
  readings: MeterReading[];
  varianceByReadingId: Map<string, MeterVariance>;
}

// Aggregate summary banner above the table — sums whatever per-shift
// variances have loaded so far (some may still be "loading…", see the
// meterReadingId/variance fetch in DashboardPage) and names the flagged
// nozzles driving it. Tolerance itself is per-shift (toleranceLitres on
// MeterVariance), not a single fixed number, so it's described rather than
// quoted as one blanket ± figure.
function VarianceSummaryBanner({ readings, varianceByReadingId }: NozzleReadingsTableProps) {
  const variances = readings
    .map((r) => varianceByReadingId.get(r.id))
    .filter((v): v is MeterVariance => v != null);

  if (variances.length === 0) return null;

  const totalVariance = variances.reduce((sum, v) => sum + v.variance, 0);
  const flagged = variances.filter((v) => v.flagged);
  const pending = variances.filter((v) => v.reconciliationPending);

  if (flagged.length === 0 && pending.length === 0) {
    return (
      <div className="banner ok">
        Aggregate meter-vs-billed variance today: {formatSignedLitres(totalVariance)} across {variances.length}{' '}
        closed shift{variances.length === 1 ? '' : 's'} — all within their per-shift tolerance.
      </div>
    );
  }

  if (flagged.length > 0) {
    const flaggedNozzles = Array.from(new Set(flagged.map((v) => v.nozzleLabel))).join(', ');
    return (
      <div className="banner">
        Aggregate meter-vs-billed variance today: {formatSignedLitres(totalVariance)}, {flagged.length} shift
        {flagged.length === 1 ? '' : 's'} outside tolerance — driven by {flaggedNozzles} below.
      </div>
    );
  }

  // No genuine flags — just shifts whose walk-in (non-itemized) sales
  // haven't been reconciled yet (Section 8A.2). Not itself a fraud signal —
  // ordinary uncaptured walk-in volume, surfaced as a reminder to log it.
  const pendingNozzles = Array.from(new Set(pending.map((v) => v.nozzleLabel))).join(', ');
  return (
    <div className="banner ok">
      Aggregate meter-vs-billed variance today: {formatSignedLitres(totalVariance)} across {variances.length}{' '}
      closed shift{variances.length === 1 ? '' : 's'} — {pending.length} shift{pending.length === 1 ? '' : 's'}{' '}
      ({pendingNozzles}) still need their walk-in sales reconciled before variance can be fully assessed.
    </div>
  );
}

// Small diverging bar, direct-labeled by the numeric variance cell right
// beside it (per the dataviz skill's "selective direct labels" rule — the
// bar carries magnitude+direction at a glance, the number stays the
// authoritative value). Blue = under (shortage), orange = over (excess) —
// deliberately not red/green, since --red is already reserved for the
// separate "flagged" status meaning (see StatusBadge) and reusing it here
// would conflate direction with severity.
function VarianceBar({ variance, maxAbs }: { variance: number; maxAbs: number }) {
  const magnitudePct = maxAbs > 0 ? Math.min(100, (Math.abs(variance) / maxAbs) * 100) : 0;
  const isPositive = variance >= 0;
  return (
    <div className="variance-bar-track" title={`${formatSignedLitres(variance)} vs billed`}>
      <div className="variance-bar-zero" />
      <div
        className="variance-bar-fill"
        style={{
          width: `${magnitudePct / 2}%`,
          background: isPositive ? 'var(--chart-diverging-pos)' : 'var(--chart-diverging-neg)',
          ...(isPositive ? { left: '50%' } : { right: '50%' }),
        }}
      />
    </div>
  );
}

// Real data note: the schema's MeterReading is one row per open/close shift
// per nozzle, at whatever times staff actually opened/closed it — there is
// no fixed "6am-6pm / 6pm-6am" split, nor a stored shift-number column,
// anywhere server-side (that was a mockup convention, not a real
// constraint). "Shift N" is derived the same way MeterReadingsPage already
// does it: each nozzle's shifts are numbered in chronological order WITHIN
// their local calendar day (a multi-day dashboard range must not let a
// nozzle's 3rd shift on Tuesday collide with its 3rd shift on Wednesday).
function computeShiftNumbers(readings: MeterReading[]): Map<string, number> {
  const byNozzleDay = new Map<string, MeterReading[]>();
  for (const r of readings) {
    const dayKey = localIsoDate(new Date(r.shiftStart));
    const key = `${r.nozzleId}::${dayKey}`;
    const bucket = byNozzleDay.get(key);
    if (bucket) bucket.push(r);
    else byNozzleDay.set(key, [r]);
  }
  const shiftNumberByReadingId = new Map<string, number>();
  for (const bucket of byNozzleDay.values()) {
    bucket.sort((a, b) => new Date(a.shiftStart).getTime() - new Date(b.shiftStart).getTime());
    bucket.forEach((r, i) => shiftNumberByReadingId.set(r.id, i + 1));
  }
  return shiftNumberByReadingId;
}

export function NozzleReadingsTable({ readings, varianceByReadingId }: NozzleReadingsTableProps) {
  const maxAbsVariance = useMemo(() => {
    let max = 0;
    for (const variance of varianceByReadingId.values()) {
      max = Math.max(max, Math.abs(variance.variance));
    }
    return max;
  }, [varianceByReadingId]);

  const shiftNumberByReadingId = useMemo(() => computeShiftNumbers(readings), [readings]);

  if (readings.length === 0) {
    return <div className="empty-box">No meter reading shifts recorded today.</div>;
  }

  return (
    <div className="table-card">
      <VarianceSummaryBanner readings={readings} varianceByReadingId={varianceByReadingId} />
      <table className="data-table">
        <thead>
          <tr>
            <th>Nozzle</th>
            <th>Staff ID</th>
            <th>Shift</th>
            <th className="num">Opening</th>
            <th className="num">Closing</th>
            <th className="num">Litres sold</th>
            <th className="num">Billed</th>
            <th className="num">Variance</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {readings.map((reading) => {
            const variance = varianceByReadingId.get(reading.id);
            const isOpen = reading.closingReading === null;
            return (
              <tr key={reading.id}>
                <td>
                  {reading.nozzle.label} <span className="section-note">({reading.nozzle.item.name})</span>
                </td>
                <td title={reading.staffId}>{reading.staffId.slice(0, 8)}&hellip;</td>
                <td title={`started ${formatTime(reading.shiftStart)}${reading.shiftEnd ? `, ended ${formatTime(reading.shiftEnd)}` : ''}`}>
                  Shift {shiftNumberByReadingId.get(reading.id) ?? 1}
                </td>
                <td className="num">{reading.openingReading.toFixed(1)}</td>
                <td className="num">{reading.closingReading !== null ? reading.closingReading.toFixed(1) : '—'}</td>
                <td className="num">
                  {reading.litresSold !== null ? formatLitres(reading.litresSold) : '—'}
                </td>
                <td className="num">
                  {variance ? formatLitres(variance.litresBilled) : isOpen ? '—' : 'loading…'}
                </td>
                <td
                  className="num"
                  style={{
                    fontWeight: 700,
                    color: variance?.flagged
                      ? 'var(--red)'
                      : variance?.reconciliationPending
                        ? 'var(--amber)'
                        : 'var(--text-dark)',
                  }}
                >
                  {variance ? (
                    <>
                      {formatSignedLitres(variance.variance)}
                      <VarianceBar variance={variance.variance} maxAbs={maxAbsVariance} />
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td>
                  {isOpen ? (
                    <StatusBadge tone="warning" label="Shift open" />
                  ) : variance ? (
                    variance.flagged ? (
                      <StatusBadge tone="critical" label="Flagged" />
                    ) : variance.reconciliationPending ? (
                      <StatusBadge tone="warning" label="Walk-in not reconciled" />
                    ) : (
                      <StatusBadge tone="good" label="Within tolerance" />
                    )
                  ) : (
                    <StatusBadge tone="neutral" label="Loading…" />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="footnote">
        Staff IDs aren&rsquo;t resolved to names because no endpoint exposes Staff lookups yet.
      </div>
    </div>
  );
}
