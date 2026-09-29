import { describe, expect, it } from 'vitest';
import { compactMoney } from './Overview';

describe('waterfall axis labels', () => {
  it('abbreviates millions so ticks fit the axis lane', () => {
    expect(compactMoney(0)).toBe('$0');
    expect(compactMoney(5000000)).toBe('$5M');
    expect(compactMoney(10000000)).toBe('$10M');
    expect(compactMoney(15000000)).toBe('$15M');
    expect(compactMoney(-2500000)).toBe('-$2.5M');
    expect(compactMoney(850000)).toBe('$850K');
  });
});
