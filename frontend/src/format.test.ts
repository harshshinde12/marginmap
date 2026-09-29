import { describe, expect, it } from 'vitest';
import { BAND_ORDER, cohortColor, costTier, formatCurrency, formatNum, formatPct, marginTone, tertileCutoffs } from './format';

describe('formatters', () => {
  it('formats currency with sign and thousands separators', () => {
    expect(formatCurrency(1234567.89)).toBe('$1,234,568');
    expect(formatCurrency(-659783.51)).toBe('-$659,784');
    expect(formatCurrency(0)).toBe('$0');
  });
  it('formats percentages to one decimal', () => {
    expect(formatPct(0.1141)).toBe('11.4%');
    expect(formatPct(-0.0558)).toBe('-5.6%');
  });
  it('formats counts', () => {
    expect(formatNum(51290)).toBe('51,290');
  });
});

describe('cohort colors', () => {
  it('maps all four cohorts to distinct colors', () => {
    const colors = new Set(
      [
        'high-revenue/high-margin',
        'high-revenue/low-margin',
        'low-revenue/high-margin',
        'low-revenue/low-margin',
      ].map(cohortColor),
    );
    expect(colors.size).toBe(4);
    expect(cohortColor('low-revenue/low-margin')).toBe('#dc2626');
    expect(cohortColor('unknown')).toBe('#64748b');
  });
});

describe('bands and tone', () => {
  it('keeps the five elasticity bands in order', () => {
    expect(BAND_ORDER).toEqual(['0%', '1-10%', '11-20%', '21-30%', '30%+']);
  });
  it('flags negative margins', () => {
    expect(marginTone(-0.01)).toBe('neg');
    expect(marginTone(0)).toBe('pos');
  });
});

describe('cost tiers', () => {
  it('splits tertiles and classifies at boundaries', () => {
    const { q1, q2 } = tertileCutoffs([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(costTier(1, q1, q2)).toBe('Low');
    expect(costTier(q1, q1, q2)).toBe('Low');
    expect(costTier(q1 + 0.01, q1, q2)).toBe('Medium');
    expect(costTier(q2, q1, q2)).toBe('Medium');
    expect(costTier(9, q1, q2)).toBe('High');
  });
  it('handles empty lists and missing values without throwing', () => {
    const { q1, q2 } = tertileCutoffs([]);
    expect(q1).toBe(0);
    expect(q2).toBe(0);
    expect(costTier(undefined, q1, q2)).toBe('Low');
    expect(costTier(null, q1, q2)).toBe('Low');
    expect(costTier(NaN, q1, q2)).toBe('Low');
  });
});
