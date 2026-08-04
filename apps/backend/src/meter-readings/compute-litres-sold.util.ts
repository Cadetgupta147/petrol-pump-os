// Rollover-aware litres calculation, shared by MeterReadingsService
// (closeShift()/correctMeterReading()/checkVariance()/withComputedLitresSold())
// and SalesReportsService (Daily Sales Report, Section 12B) — extracted to a
// standalone, framework-free function so the two callers can't drift, same
// convention as shift-schedule/resolve-current-shift-window.ts. null only
// when closingReading itself is null (shift still open).
export function computeLitresSold(
  openingReading: number,
  closingReading: number | null,
  meterRolledOver: boolean,
  rolloverAt: number | null,
): number | null {
  if (closingReading === null) return null;
  if (meterRolledOver && rolloverAt != null) {
    return rolloverAt - openingReading + closingReading;
  }
  return closingReading - openingReading;
}
