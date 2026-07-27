import { computeCreditLimitSuggestion } from './credit-limit-suggestions.util';

// Section 17.25 — rule-heavy per CLAUDE.md (money-adjacent, feeds a
// credit-limit change even though it never auto-applies one). Covers all
// three branches plus the two "can't compute" edge cases.
describe('computeCreditLimitSuggestion', () => {
  it('suggests a 20% increase, rounded, when there is no outstanding balance', () => {
    const result = computeCreditLimitSuggestion({
      creditLimit: 10000,
      bucket15to30: 0,
      bucket30Plus: 0,
      totalOutstanding: 0,
    });

    expect(result.action).toBe('INCREASE');
    expect(result.suggestedLimit).toBe(12000);
  });

  it('suggests no change when outstanding is entirely within 15 days', () => {
    const result = computeCreditLimitSuggestion({
      creditLimit: 10000,
      bucket15to30: 0,
      bucket30Plus: 0,
      totalOutstanding: 3000,
    });

    expect(result.action).toBe('NO_CHANGE');
    expect(result.suggestedLimit).toBe(10000);
  });

  it('suggests no change (not increase) when 15-30 day aging exists but nothing 30+', () => {
    const result = computeCreditLimitSuggestion({
      creditLimit: 10000,
      bucket15to30: 2000,
      bucket30Plus: 0,
      totalOutstanding: 2000,
    });

    expect(result.action).toBe('NO_CHANGE');
    expect(result.reasoning).toMatch(/15-30/);
  });

  it('suggests freeze/reduce, capped at outstanding, when anything is 30+ days overdue', () => {
    const result = computeCreditLimitSuggestion({
      creditLimit: 10000,
      bucket15to30: 0,
      bucket30Plus: 4000,
      totalOutstanding: 4000,
    });

    expect(result.action).toBe('FREEZE_OR_REDUCE');
    expect(result.suggestedLimit).toBe(4000);
  });

  it('never suggests raising the limit above its current value when freezing/reducing', () => {
    // Outstanding (4000) exceeds the existing limit (3000) — already over
    // limit. suggestedLimit must stay at the LOWER of the two, not jump up
    // to "cap at outstanding".
    const result = computeCreditLimitSuggestion({
      creditLimit: 3000,
      bucket15to30: 0,
      bucket30Plus: 4000,
      totalOutstanding: 4000,
    });

    expect(result.action).toBe('FREEZE_OR_REDUCE');
    expect(result.suggestedLimit).toBe(3000);
  });

  it('never suggests an increase from a zero credit limit — no baseline to scale', () => {
    const result = computeCreditLimitSuggestion({
      creditLimit: 0,
      bucket15to30: 0,
      bucket30Plus: 0,
      totalOutstanding: 0,
    });

    expect(result.action).toBe('NO_CHANGE');
    expect(result.suggestedLimit).toBe(0);
  });
});
