// Shared local-calendar day-range parsing: 'YYYY-MM-DD' (a full ISO datetime
// string also passes @IsDateString on DateRangeQueryDto, but only the first
// 10 chars are read here) -> start-of-day / end-of-day Date objects.
//
// Same convention already used in two places in this codebase
// (dashboard.service.ts's local getStartAndEndOfToday(), and
// tally-export.service.ts's local parseDateRange()) — pulled out here as the
// shared version for every report added after this one, so a third/fourth
// near-identical copy doesn't accumulate. The two existing call sites are
// left as-is (out of scope to refactor here) rather than risk touching
// working, already-shipped modules for a pure style cleanup.
export function parseDateRangeStrings(
  from: string,
  to: string,
): { start: Date; end: Date } {
  const [fromYear, fromMonth, fromDay] = from
    .slice(0, 10)
    .split('-')
    .map(Number);
  const [toYear, toMonth, toDay] = to.slice(0, 10).split('-').map(Number);

  const start = new Date(fromYear, fromMonth - 1, fromDay, 0, 0, 0, 0);
  const end = new Date(toYear, toMonth - 1, toDay, 23, 59, 59, 999);
  return { start, end };
}

// The inverse of parseDateRangeStrings — formats a Date back to its LOCAL
// calendar-day string. Deliberately NOT `date.toISOString().slice(0, 10)`:
// that converts to UTC first, which can shift the calendar day depending on
// the server's local timezone offset (the exact bug this function exists to
// avoid reintroducing — a `start`/`end` built by parseDateRangeStrings above
// is already anchored to a local midnight/end-of-day, and re-deriving its
// date via UTC conversion can silently disagree with the string that
// produced it).
export function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
