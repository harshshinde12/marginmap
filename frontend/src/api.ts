export const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://127.0.0.1:8000';

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${API_URL}${path}`);
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return r.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return r.json() as Promise<T>;
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${API_URL}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return r.json() as Promise<T>;
}

export interface Summary {
  n_lines: number;
  total_original_sales: number;
  total_effective_sales: number;
  total_gross: number;
  total_shipping: number;
  total_support: number;
  total_return_cost: number;
  total_net: number;
  n_returned_lines: number;
  gross_margin_pct: number;
  net_margin_pct: number;
}

export interface ProfitRow {
  grp: string;
  label: string;
  n_lines: number;
  n_returned_lines: number;
  sales: number;
  sales_original: number;
  cogs: number;
  gross: number;
  shipping: number;
  support: number;
  return_cost: number;
  net: number;
  gross_pct: number;
  net_pct: number;
}

export interface Tag {
  key: string;
  label: string;
  value: number;
}

export interface CohortRow extends ProfitRow {
  eid: string;
  revenue: number;
  contribution: number;
  contribution_pct: number;
  cost_to_serve: number;
  cohort: string;
  cohort_display: string;
  status_badge: string;
  tags: Tag[];
  avg_discount: number;
  return_rate: number;
  freight_share: number;
}

export interface LossRow extends CohortRow {
  driver: string | null;
  driver_share: number;
}

export interface KpiPoint {
  month: string;
  revenue: number;
  gross: number;
  net: number;
  gross_pct: number;
  net_pct: number;
  n_lines: number;
}

export interface HeatCell {
  row: string;
  row_label: string;
  col: string;
  n_lines: number;
  revenue: number;
  net: number;
  net_pct: number;
}

export interface EntityPoint {
  month: string;
  n_lines: number;
  revenue: number;
  net: number;
  net_pct: number;
}

export interface CostStructure {
  totals: {
    revenue: number;
    cogs: number;
    shipping: number;
    support: number;
    ret: number;
    net: number;
    gross: number;
    list_price: number;
  };
  by_ship_mode: { mode: string; n_lines: number; revenue: number; shipping: number; net: number }[];
  freight_by_bucket: Record<string, number>;
  assumption_note: string;
}

export interface Flag {
  id: number;
  entity_type: string;
  entity_id: string;
  status: string;
  note: string;
  flagged_at: string;
}

export interface TreemapNode {
  name: string;
  revenue: number;
  net: number;
  net_pct: number;
  n_lines: number;
  children?: TreemapNode[];
}

export interface FrequencyCell {
  freq_band: string;
  tier: string;
  n_customers: number;
  revenue: number;
  net: number;
  avg_net_pct: number;
}

export const api = {
  summary: () => get<Summary>('/summary'),
  profitability: (group_by: string, limit?: number) =>
    get<{ group_by: string; rows: ProfitRow[] }>(
      `/profitability?group_by=${group_by}${limit ? `&limit=${limit}` : ''}`,
    ),
  costToServe: (dimension: 'customer' | 'product', limit = 500) =>
    get<{
      dimension: string;
      median_revenue: number;
      median_net_pct: number;
      n_entities: number;
      cohort_counts: Record<string, number>;
      cohort_display: Record<string, string>;
      badge_cutoffs: { critical_below: number; moderate_below: number };
      tag_thresholds: { high_discount_above: number; excess_returns_above: number; logistics_surge_above: number };
      rows: CohortRow[];
    }>(`/cost-to-serve?dimension=${dimension}&limit=${limit}`),
  lossMakers: (dimension: string, limit = 50) =>
    get<{ dimension: string; threshold: number; n_loss_makers: number; rows: LossRow[] }>(
      `/loss-makers?dimension=${dimension}&limit=${limit}`,
    ),
  elasticity: (group_by: string) =>
    get<{ group_by: string; bands: string[]; rows: ElasticityRow[] }>(
      `/elasticity?group_by=${group_by}`,
    ),
  simulate: (
    dimension: string,
    entity_id: string,
    new_discount_pct: number,
    scenario?: { price_adj?: number; cogs_red?: number; ship_cut?: number; vol_override?: number },
  ) => post<SimResult>('/simulate', { dimension, entity_id, new_discount_pct, ...(scenario ?? {}) }),
  variance: (month?: string) => get<VarianceResult>(`/variance${month ? `?month=${month}` : ''}`),
  months: () => get<{ months: string[]; earliest: string; latest: string; n_months: number }>('/months'),
  kpiTrend: (months_n = 6) => get<{ months: string[]; points: KpiPoint[] }>('/kpi-trend?months_n=' + months_n),
  uiAssumptions: () => get<{ assumptions: string[] }>('/ui-assumptions'),
  heatmap: (rows: string, cols: string, limit = 50, offset = 0) =>
    get<{
      rows_dim: string;
      cols_dim: string;
      row_totals: { row: string; row_label: string; net: number; revenue: number; n_lines: number; net_pct: number }[];
      n_rows_total: number;
      cells: HeatCell[];
      total_net_cells: number;
      summary_net: number;
      reconciles: boolean;
    }>(`/margin-heatmap?rows=${rows}&cols=${cols}&limit=${limit}&offset=${offset}`),
  entityTrend: (dimension: string, id: string) =>
    get<{ dimension: string; entity_id: string; n_months: number; points: EntityPoint[] }>(
      `/entity-trend?dimension=${dimension}&id=${encodeURIComponent(id)}`,
    ),
  costStructure: () => get<CostStructure>('/cost-structure'),
  treemap: () =>
    get<{
      nodes: TreemapNode[];
      total_net_cells: number;
      summary_net: number;
      reconciles: boolean;
      assumption_note: string;
    }>('/treemap'),
  frequencyHeatmap: () =>
    get<{
      frequency_bands: string[];
      tiers: string[];
      tier_thresholds: { low_below: number; medium_below: number };
      cells: FrequencyCell[];
      n_customers: number;
      total_net_cells: number;
      summary_net: number;
      reconciles: boolean;
      assumption_note: string;
    }>('/frequency-heatmap'),
  drillTree: (category?: string, sub_category?: string, limit = 50) => {
    const q = new URLSearchParams();
    if (category) q.set('category', category);
    if (sub_category) q.set('sub_category', sub_category);
    q.set('limit', String(limit));
    return get<DrillTreeResult>(`/drill-tree?${q.toString()}`);
  },
  flags: (params?: { entity_type?: string; entity_id?: string; status?: string }) => {
    const q = new URLSearchParams();
    if (params?.entity_type) q.set('entity_type', params.entity_type);
    if (params?.entity_id) q.set('entity_id', params.entity_id);
    if (params?.status) q.set('status', params.status);
    const s = q.toString();
    return get<{ n_flags: number; flags: Flag[] }>(`/flags${s ? `?${s}` : ''}`);
  },
  createFlag: (entity_type: string, entity_id: string, note = '', status = 'open') =>
    post<Flag>('/flags', { entity_type, entity_id, note, status }),
  updateFlag: (id: number, body: { status?: string; note?: string }) => patch<Flag>(`/flags/${id}`, body),
};

export interface ElasticityRow {
  grp: string;
  band: string;
  n_lines: number;
  avg_qty: number;
  avg_discount: number;
  revenue: number;
  contribution: number;
  net: number;
  contribution_pct: number;
  net_pct: number;
}

export interface SimResult {
  dimension: string;
  entity_id: string;
  lookup_segment: string;
  current_band: string;
  new_band: string;
  baseline: { n_lines: number; qty: number; sales: number; contribution: number; avg_discount_pct: number };
  projection: { qty: number; sales: number; contribution: number };
  delta: { qty: number; sales: number; contribution: number };
  ratios: { price: number; volume: number };
  scenario: { price_adj: number; cogs_red: number; ship_cut: number; vol_override: number };
  band_table: Record<string, number>;
  assumption_note: string;
}

export interface DrillTreeResult {
  level: string;
  parent?: string;
  parent_net?: number;
  n_products_total?: number;
  children: {
    name?: string;
    pid?: string;
    label?: string;
    n_lines: number;
    revenue: number;
    net: number;
    net_pct: number;
    share_of_parent?: number;
  }[];
}

export interface VarianceResult {  month: string;
  previous_month: string;
  current: Record<string, number | string>;
  previous: Record<string, number | string>;
  prior_year_month: string | null;
  prior_year: Record<string, number | string> | null;
  year_over_year: Record<string, number> | null;
  deltas: Record<string, number>;
  drivers: { component: string; delta_net_dollars: number }[];
  category_net_swings: { category: string; delta_net: number }[];
  narrative: string;
  assumption_note: string;
}
