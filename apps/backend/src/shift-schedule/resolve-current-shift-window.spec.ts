import { resolveCurrentShiftWindow } from './resolve-current-shift-window';

// Meter Reading redesign (Section 3.3) — this is the one piece of real
// date-math in the shift-schedule slice (everything else is plain CRUD), so
// it gets the thorough table-testing CLAUDE.md asks for on rule-heavy logic.
describe('resolveCurrentShiftWindow', () => {
  it('returns null when no shift definitions are configured', () => {
    expect(resolveCurrentShiftWindow([], new Date('2026-07-25T10:00:00'))).toBeNull();
  });

  it('resolves a plain same-day shift when now falls inside it', () => {
    const shift1 = { id: 's1', startTime: '06:00', endTime: '14:00' };
    const result = resolveCurrentShiftWindow([shift1], new Date('2026-07-25T10:00:00'));
    expect(result?.shiftDefinition).toBe(shift1);
    expect(result?.windowStart).toEqual(new Date('2026-07-25T06:00:00'));
    expect(result?.windowEnd).toEqual(new Date('2026-07-25T14:00:00'));
  });

  it('returns null when now falls in a genuine gap between shifts (never blocks, just no label)', () => {
    const shift1 = { id: 's1', startTime: '06:00', endTime: '14:00' };
    const result = resolveCurrentShiftWindow([shift1], new Date('2026-07-25T16:00:00'));
    expect(result).toBeNull();
  });

  it('resolves a same-calendar-day occurrence of a wrapping overnight shift', () => {
    const shift3 = { id: 's3', startTime: '22:00', endTime: '06:00' };
    // 23:30 on the 25th — inside the 25th's 22:00 start, before the 26th's 06:00 end.
    const result = resolveCurrentShiftWindow([shift3], new Date('2026-07-25T23:30:00'));
    expect(result?.shiftDefinition).toBe(shift3);
    expect(result?.windowStart).toEqual(new Date('2026-07-25T22:00:00'));
    expect(result?.windowEnd).toEqual(new Date('2026-07-26T06:00:00'));
  });

  it("resolves the previous calendar day's occurrence of a wrapping shift in the early morning", () => {
    const shift3 = { id: 's3', startTime: '22:00', endTime: '06:00' };
    // 02:00 on the 25th — the 25th's own 22:00 start hasn't happened yet;
    // this is really still the shift that started at 22:00 on the 24th.
    const result = resolveCurrentShiftWindow([shift3], new Date('2026-07-25T02:00:00'));
    expect(result?.shiftDefinition).toBe(shift3);
    expect(result?.windowStart).toEqual(new Date('2026-07-24T22:00:00'));
    expect(result?.windowEnd).toEqual(new Date('2026-07-25T06:00:00'));
  });

  it('resolves the correct shift among several contiguous definitions covering a full day', () => {
    const shift1 = { id: 's1', startTime: '06:00', endTime: '14:00' };
    const shift2 = { id: 's2', startTime: '14:00', endTime: '22:00' };
    const shift3 = { id: 's3', startTime: '22:00', endTime: '06:00' };
    const defs = [shift1, shift2, shift3];

    expect(resolveCurrentShiftWindow(defs, new Date('2026-07-25T09:00:00'))?.shiftDefinition).toBe(shift1);
    expect(resolveCurrentShiftWindow(defs, new Date('2026-07-25T18:00:00'))?.shiftDefinition).toBe(shift2);
    expect(resolveCurrentShiftWindow(defs, new Date('2026-07-25T23:00:00'))?.shiftDefinition).toBe(shift3);
    expect(resolveCurrentShiftWindow(defs, new Date('2026-07-25T03:00:00'))?.shiftDefinition).toBe(shift3);
  });

  it('treats a window end as exclusive — the exact boundary instant belongs to the next shift, not this one', () => {
    const shift1 = { id: 's1', startTime: '06:00', endTime: '14:00' };
    const shift2 = { id: 's2', startTime: '14:00', endTime: '22:00' };
    const result = resolveCurrentShiftWindow([shift1, shift2], new Date('2026-07-25T14:00:00'));
    expect(result?.shiftDefinition).toBe(shift2);
  });
});
