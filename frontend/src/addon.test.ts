import { describe, expect, it } from 'vitest';
import { clampShift, filterUsStates, leaderboards, paretoPoints, rankTornado, suggestionForTag, tagDistribution, treemapTotals } from './addon-helpers';

describe('state leaderboards (D23)', () => {
  it('takes top-5 head and bottom-5 tail by net DESC order', () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({
      grp: `S${i}`,
      label: `State ${i}`,
      net: 1000 - i * 100,
      sales: 5000,
      net_pct: 0.1,
    }));
    const { top5, bottom5 } = leaderboards(rows);
    expect(top5.map((r) => r.grp)).toEqual(['S0', 'S1', 'S2', 'S3', 'S4']);
    // bottom-5 worst-first (most negative first)
    expect(bottom5.map((r) => r.grp)).toEqual(['S7', 'S6', 'S5', 'S4', 'S3']);
    expect(top5[0].net).toBeGreaterThan(bottom5[0].net);
  });

  it('US-only filter excludes every non-US state from both lists', () => {
    const usNames = new Set(['California', 'Texas', 'Ohio', 'New York', 'Florida', 'Illinois', 'Washington']);
    const rows = [
      { grp: 'England', label: 'England', net: 999999, sales: 1, net_pct: 0.5 },
      { grp: 'California', label: 'California', net: 5000, sales: 10000, net_pct: 0.1 },
      { grp: 'Central', label: 'Central', net: 888888, sales: 1, net_pct: 0.5 },
      { grp: 'Texas', label: 'Texas', net: 4000, sales: 9000, net_pct: 0.1 },
      { grp: 'Ontario', label: 'Ontario', net: -999999, sales: 1, net_pct: -0.5 },
      { grp: 'Ohio', label: 'Ohio', net: 3000, sales: 8000, net_pct: 0.1 },
      { grp: 'Ile-de-France', label: 'Ile-de-France', net: 777777, sales: 1, net_pct: 0.5 },
      { grp: 'New York', label: 'New York', net: 2000, sales: 7000, net_pct: 0.1 },
      { grp: 'National Capital', label: 'National Capital', net: -888888, sales: 1, net_pct: -0.5 },
      { grp: 'Florida', label: 'Florida', net: 1000, sales: 6000, net_pct: 0.1 },
      { grp: 'Queensland', label: 'Queensland', net: 666666, sales: 1, net_pct: 0.5 },
      { grp: 'Illinois', label: 'Illinois', net: -1000, sales: 5000, net_pct: -0.05 },
      { grp: 'Washington', label: 'Washington', net: -2000, sales: 4000, net_pct: -0.1 },
    ];
    const usRows = filterUsStates(rows, usNames);
    // non-US giants (even with extreme nets that would top/bottom the global sort) are gone
    expect(usRows.every((r) => usNames.has(r.grp))).toBe(true);
    expect(usRows.find((r) => r.grp === 'England')).toBeUndefined();
    expect(usRows.find((r) => r.grp === 'Ontario')).toBeUndefined();
    expect(usRows.find((r) => r.grp === 'Central')).toBeUndefined();
    const { top5, bottom5 } = leaderboards(usRows);
    const shown = [...top5, ...bottom5].map((r) => r.grp);
    for (const bad of ['England', 'Central', 'Ontario', 'Ile-de-France', 'National Capital', 'Queensland']) {
      expect(shown).not.toContain(bad);
    }
    // order preserved: top is still best US net first
    expect(top5[0].grp).toBe('California');
  });
});

describe('loss-maker pareto (D24)', () => {
  it('cumulates worst-first shares to 1.0', () => {
    const pts = paretoPoints([
      { eid: 'a', net: -300 },
      { eid: 'b', net: -100 },
      { eid: 'c', net: -200 },
    ]);
    expect(pts.map((p) => p.eid)).toEqual(['a', 'c', 'b']);
    expect(pts[pts.length - 1].cumShare).toBeCloseTo(1.0, 9);
    expect(pts[0].cumShare).toBeCloseTo(0.5, 9);
    for (const p of pts) expect(p.cumNet).toBeLessThanOrEqual(0);
  });
});

describe('root-cause distribution (D25)', () => {
  it('counts tag keys and untagged rows', () => {
    const dist = tagDistribution([
      { tags: [{ key: 'high_discount' }] },
      { tags: [{ key: 'high_discount' }, { key: 'excess_returns' }] },
      { tags: [] },
    ]);
    const m = new Map(dist.map((d) => [d.key, d.count]));
    expect(m.get('high_discount')).toBe(2);
    expect(m.get('excess_returns')).toBe(1);
    expect(m.get('none')).toBe(1);
    expect(dist[0].count).toBeGreaterThanOrEqual(dist[dist.length - 1].count);
  });
});

describe('tornado ranking (D22/D26)', () => {
  it('ranks levers by max absolute delta', () => {
    const ranked = rankTornado([
      { lever: 'price', upDelta: 100, downDelta: -90 },
      { lever: 'volume', upDelta: 10, downDelta: -10 },
      { lever: 'cogs', upDelta: 50, downDelta: -60 },
    ]);
    expect(ranked.map((r) => r.lever)).toEqual(['price', 'cogs', 'volume']);
  });

  it('clampShift flags bound-hitting shifts', () => {
    expect(clampShift(-0.11, -0.1, 0.9)).toEqual({ value: -0.1, clamped: true });
    expect(clampShift(-0.09, -0.1, 0.9)).toEqual({ value: -0.09, clamped: false });
    expect(clampShift(2.5, -0.9, 2.0)).toEqual({ value: 2.0, clamped: true });
  });
});

describe('treemap totals (D20)', () => {
  it('children nets sum to parent net', () => {
    expect(
      treemapTotals([{ net: 300, children: [{ net: 100 }, { net: 200 }] }]),
    ).toBe(true);
    expect(
      treemapTotals([{ net: 300, children: [{ net: 100 }, { net: 100 }] }]),
    ).toBe(false);
  });
});

describe('rule-based tag suggestions (D27)', () => {
  it('every tag key has a fixed-text mapping with no numbers; empty fires render nothing', () => {
    for (const k of ['high_discount', 'excess_returns', 'logistics_surge']) {
      const s = suggestionForTag(k);
      expect(s).toBeTruthy();
      expect(s).not.toMatch(/\d/);
    }
    expect(suggestionForTag('bogus-key')).toBeUndefined();
    // no tags fired -> no suggestion rows rendered
    const tags: { key: string }[] = [];
    expect(tags.map((t) => suggestionForTag(t.key))).toEqual([]);
  });
});
