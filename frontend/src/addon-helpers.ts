/** Pure helpers for the ADD-ON PHASE visuals — all inputs are live API fields, no mocks. */

export interface LeaderRow {
  grp: string;
  label: string;
  net: number;
  sales: number;
  net_pct: number;
}

/** Top-5 / Bottom-5 by net $. Backend sorts net DESC, so top = first 5, bottom = last 5. */
export function leaderboards<T extends LeaderRow>(rows: T[]): { top5: T[]; bottom5: T[] } {
  const top5 = rows.slice(0, 5);
  const bottom5 = rows.length <= 5 ? [...rows].reverse() : rows.slice(-5).reverse();
  return { top5, bottom5 };
}

/** Restrict state rows to the US-only set that powers the choropleth map.
 *  `usNames` must be the map boundary names (us-states.json features).
 *  US state names are unique in the data (0 overlap with non-US states,
 *  verified 2026-09-28), so name filtering excludes non-US rows and avoids
 *  merged cross-country duplicates. Order is preserved (still net DESC). */
export function filterUsStates<T extends LeaderRow>(rows: T[], usNames: Set<string> | string[]): T[] {
  const set = usNames instanceof Set ? usNames : new Set(usNames);
  return rows.filter((r) => set.has(r.grp));
}

/** Clamp a sensitivity shift to backend bounds, flagging whether clamping occurred. */
export function clampShift(value: number, lo: number, hi: number): { value: number; clamped: boolean } {
  const clampedVal = Math.min(hi, Math.max(lo, value));
  return { value: clampedVal, clamped: clampedVal !== value };
}

export interface ParetoInput {
  eid: string;
  net: number;
}

export interface ParetoPoint extends ParetoInput {
  cumNet: number;
  cumShare: number;
}

/** Worst-first Pareto: cumulative share of total loss-maker net (both negative, share 0..1). */
export function paretoPoints(rows: ParetoInput[]): ParetoPoint[] {
  const sorted = [...rows].sort((a, b) => a.net - b.net);
  const total = sorted.reduce((s, r) => s + r.net, 0);
  let cum = 0;
  return sorted.map((r) => {
    cum += r.net;
    return { ...r, cumNet: cum, cumShare: total ? cum / total : 0 };
  });
}

export interface TaggedRow {
  tags: { key: string }[];
}

/** Count tag keys across loss-maker rows; untagged rows count as `none`. */
export function tagDistribution(rows: TaggedRow[]): { key: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!r.tags || r.tags.length === 0) {
      counts.set('none', (counts.get('none') ?? 0) + 1);
    } else {
      for (const t of r.tags) counts.set(t.key, (counts.get(t.key) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);
}

export interface SensitivityLever {
  lever: string;
  downDelta: number;
  upDelta: number;
}

/** Rank tornado levers by max absolute contribution delta (D22/D26). */
export function rankTornado(levers: SensitivityLever[]): (SensitivityLever & { span: number })[] {
  return levers
    .map((l) => ({ ...l, span: Math.max(Math.abs(l.upDelta), Math.abs(l.downDelta)) }))
    .sort((a, b) => b.span - a.span);
}

/** Treemap level totals reconcile: children nets sum to parent net. */
export function treemapTotals(nodes: { net: number; children?: { net: number }[] }[]): boolean {
  return nodes.every((n) => {
    if (!n.children || n.children.length === 0) return true;
    const sum = n.children.reduce((s, k) => s + k.net, 0);
    return Math.abs(sum - n.net) < 0.01;
  });
}

/** Fixed-text rule-based suggestions per root-cause tag key (D27).
 *  No projected savings, no numbers beyond the measured tag values —
 *  each string is static text; the measured value comes from the tag label. */
export const TAG_SUGGESTIONS: Record<string, string> = {
  high_discount: 'Review the discount ceiling for this item.',
  excess_returns: 'Investigate return causes for this item.',
  logistics_surge: 'Review ship mode and freight terms for this item.',
};

/** Suggestion for one tag key, or undefined when the key has no mapping
 *  (the drawer then renders nothing extra for that tag). */
export function suggestionForTag(key: string): string | undefined {
  return TAG_SUGGESTIONS[key];
}
