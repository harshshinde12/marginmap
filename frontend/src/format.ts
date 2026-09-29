export function formatCurrency(v: number): string {
  const sign = v < 0 ? '-' : '';
  return `${sign}$${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

export function formatPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

export function formatNum(v: number): string {
  return v.toLocaleString('en-US');
}

export const COHORT_COLORS: Record<string, string> = {
  'high-revenue/high-margin': '#059669',
  'high-revenue/low-margin': '#f59e0b',
  'low-revenue/high-margin': '#0ea5e9',
  'low-revenue/low-margin': '#dc2626',
};

export function cohortColor(cohort: string): string {
  return COHORT_COLORS[cohort] ?? '#64748b';
}

export const BAND_ORDER = ['0%', '1-10%', '11-20%', '21-30%', '30%+'];

export function marginTone(v: number): 'pos' | 'neg' {
  return v >= 0 ? 'pos' : 'neg';
}

export type CostTier = 'Low' | 'Medium' | 'High';

/** Tertile cutoffs of a cost list (relative tiers within the shown set, never fixed cutoffs). */
export function tertileCutoffs(values: number[]): { q1: number; q2: number } {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return { q1: 0, q2: 0 };
  return {
    q1: sorted[Math.floor(sorted.length / 3)] ?? 0,
    q2: sorted[Math.floor((2 * sorted.length) / 3)] ?? 0,
  };
}

/** Classify one cost value against tertile cutoffs. Missing/NaN costs sort into Low. */
export function costTier(value: number | null | undefined, q1: number, q2: number): CostTier {
  const v = typeof value === 'number' && !Number.isNaN(value) ? value : 0;
  if (v <= q1) return 'Low';
  if (v <= q2) return 'Medium';
  return 'High';
}
