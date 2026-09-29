import type { ElasticityRow } from './api';
import { BAND_ORDER } from './format';

/** Order band rows for charts; missing bands are omitted (never blank-screen). */
export function BAND_ORDER_HELPER(rows: ElasticityRow[]): ElasticityRow[] {
  const order = new Map(BAND_ORDER.map((b, i) => [b, i]));
  return [...rows].sort((a, b) => (order.get(a.band) ?? 99) - (order.get(b.band) ?? 99));
}
