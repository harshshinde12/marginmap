import { describe, expect, it } from 'vitest';
import { colorDomain } from './Choropleth';

const v = (net_pct: number) => ({ net_pct });

describe('choropleth color domain', () => {
  it('covers US negatives and positives from rendered states only', () => {
    const values = new Map([
      ['Colorado', v(-0.408)],
      ['Texas', v(-0.295)],
      ['California', v(-0.023)],
      ['Vermont', v(0.12)],
      ['New York', v(0.347)],
    ]);
    const d = colorDomain(values, ['Colorado', 'Texas', 'California', 'Vermont', 'New York']);
    expect(d.lo).toBeCloseTo(-0.408, 6);
    expect(d.hi).toBeCloseTo(0.347, 6);
    expect(d.maxAbs).toBeCloseTo(0.408, 6);
  });
  it('ignores global outliers not on the map', () => {
    const values = new Map([
      ['Al Hudaydah', v(-2.376)],
      ['Colorado', v(-0.408)],
      ['Vermont', v(0.12)],
    ]);
    const d = colorDomain(values, ['Colorado', 'Vermont']);
    expect(d.lo).toBeCloseTo(-0.408, 6);
    expect(d.maxAbs).toBeCloseTo(0.408, 6);
  });
  it('skips missing and NaN entries without throwing', () => {
    const values = new Map([['Colorado', v(NaN)]]);
    const d = colorDomain(values, ['Colorado', 'Nowhere']);
    expect(d).toEqual({ maxAbs: 1, lo: 0, hi: 0 });
  });
});
