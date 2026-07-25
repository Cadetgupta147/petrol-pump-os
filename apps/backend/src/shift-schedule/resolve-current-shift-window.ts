// Meter Reading redesign (Section 3.3) — pure date-math helper resolving
// which configured shift window a reference instant falls into. Used PURELY
// for display/labeling (the DSM app's batch-close screen header, GET
// /shift-schedule/current) — NEVER to validate or block a batch-close
// submission. The product decision behind this redesign was explicit: exact
// shift-boundary precision doesn't matter, so a gap in the schedule or a
// submission a few minutes late must never turn into an error here, only a
// missing label.
//
// Standalone (no NestJS/Prisma imports) so it's directly unit-testable, same
// convention as common/resolve-assignable-actor.ts.
export interface ShiftTimeRange {
  startTime: string; // "HH:mm", 24h wall-clock
  endTime: string; // "HH:mm" — may be numerically "before" startTime (wraps past midnight)
}

export interface ResolvedShiftWindow<T> {
  shiftDefinition: T;
  windowStart: Date;
  windowEnd: Date;
}

function timeToMinutes(hhmm: string): number {
  const [hours, minutes] = hhmm.split(':').map(Number);
  return hours * 60 + minutes;
}

// Combines `base`'s calendar date with `hhmm`'s time-of-day, in local time.
function atLocalTime(base: Date, hhmm: string): Date {
  const [hours, minutes] = hhmm.split(':').map(Number);
  return new Date(base.getFullYear(), base.getMonth(), base.getDate(), hours, minutes, 0, 0);
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

// Checks both the window anchored on `now`'s own calendar date and the one
// anchored a day earlier, so a wrapping shift (e.g. 22:00-06:00) still
// resolves correctly in the early hours of the day it ends on, before its
// "today" occurrence has even started.
export function resolveCurrentShiftWindow<T extends ShiftTimeRange>(
  shiftDefinitions: T[],
  now: Date,
): ResolvedShiftWindow<T> | null {
  for (const def of shiftDefinitions) {
    const wraps = timeToMinutes(def.endTime) <= timeToMinutes(def.startTime);

    const todayStart = atLocalTime(now, def.startTime);
    const todayEnd = wraps ? addDays(atLocalTime(now, def.endTime), 1) : atLocalTime(now, def.endTime);
    if (now >= todayStart && now < todayEnd) {
      return { shiftDefinition: def, windowStart: todayStart, windowEnd: todayEnd };
    }

    const yesterdayStart = addDays(todayStart, -1);
    const yesterdayEnd = addDays(todayEnd, -1);
    if (now >= yesterdayStart && now < yesterdayEnd) {
      return { shiftDefinition: def, windowStart: yesterdayStart, windowEnd: yesterdayEnd };
    }
  }
  return null;
}
