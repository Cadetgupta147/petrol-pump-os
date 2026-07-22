import type { MeterReading, MeterVariance } from '../../api/types';
import { formatLitres, formatSignedLitres, formatTime } from '../../utils/format';

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

  if (flagged.length === 0) {
    return (
      <div className="banner ok">
        Aggregate meter-vs-billed variance today: {formatSignedLitres(totalVariance)} across {variances.length}{' '}
        closed shift{variances.length === 1 ? '' : 's'} — all within their per-shift tolerance.
      </div>
    );
  }

  const flaggedNozzles = Array.from(new Set(flagged.map((v) => v.nozzleLabel))).join(', ');
  return (
    <div className="banner">
      Aggregate meter-vs-billed variance today: {formatSignedLitres(totalVariance)}, {flagged.length} shift
      {flagged.length === 1 ? '' : 's'} outside tolerance — driven by {flaggedNozzles} below.
    </div>
  );
}

// Real data note: the schema's MeterReading is one row per open/close shift
// per nozzle, at whatever times staff actually opened/closed it — there is
// no fixed "6am-6pm / 6pm-6am" split anywhere server-side (that was a
// mockup convention, not a real constraint). Showing actual shift start/end
// times here instead of forcing them into two artificial buckets.
export function NozzleReadingsTable({ readings, varianceByReadingId }: NozzleReadingsTableProps) {
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
            <th>Shift start</th>
            <th>Shift end</th>
            <th className="num">Meter reading</th>
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
                  {reading.nozzle.label} <span className="section-note">({reading.nozzle.productType})</span>
                </td>
                <td title={reading.staffId}>{reading.staffId.slice(0, 8)}&hellip;</td>
                <td>{formatTime(reading.shiftStart)}</td>
                <td>{reading.shiftEnd ? formatTime(reading.shiftEnd) : '—'}</td>
                <td className="num">
                  {reading.openingReading.toFixed(1)}
                  {reading.closingReading !== null ? ` → ${reading.closingReading.toFixed(1)}` : ' → open'}
                </td>
                <td className="num">
                  {reading.litresSold !== null ? formatLitres(reading.litresSold) : '—'}
                </td>
                <td className="num">
                  {variance ? formatLitres(variance.litresBilled) : isOpen ? '—' : 'loading…'}
                </td>
                <td className="num" style={{ fontWeight: 700, color: variance?.flagged ? 'var(--red)' : 'var(--text-dark)' }}>
                  {variance ? formatSignedLitres(variance.variance) : '—'}
                </td>
                <td>
                  {isOpen ? (
                    <span className="badge" style={{ background: 'var(--amber-bg)', color: 'var(--amber)' }}>
                      Shift open
                    </span>
                  ) : variance ? (
                    <span
                      className="badge"
                      style={{
                        background: variance.flagged ? 'var(--red-bg)' : 'var(--green-bg)',
                        color: variance.flagged ? 'var(--red)' : 'var(--green)',
                      }}
                    >
                      {variance.flagged ? 'Flagged' : 'Within tolerance'}
                    </span>
                  ) : (
                    <span className="badge" style={{ background: 'var(--page-bg)', color: 'var(--gray)' }}>
                      Loading…
                    </span>
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
