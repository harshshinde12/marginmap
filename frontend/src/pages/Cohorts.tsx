import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import type { ExportFn } from '../App';
import { api } from '../api';
import type { CohortRow } from '../api';
import { cohortColor, costTier, formatCurrency, formatPct, tertileCutoffs } from '../format';
import type { CostTier } from '../format';
import { Card, EmptyBlock, ErrorBlock, ChartSkeleton, MarginBar, RichTooltip, AXIS_PROPS, ChartTooltip, COST_COLORS, GRID_PROPS, REF_LINE_PROPS, TICK_PROPS, BADGE_NEG, BADGE_POS, BADGE_WARN, downloadCSV, marginCellBg, money, pct } from '../components';

const COHORTS = [
  'high-revenue/high-margin',
  'high-revenue/low-margin',
  'low-revenue/high-margin',
  'low-revenue/low-margin',
];

type Tier = CostTier;

const TIER_STYLE: Record<Tier, string> = {
  Low: BADGE_POS,
  Medium: BADGE_WARN,
  High: BADGE_NEG,
};

const TIER_PILL_LABEL: Record<Tier | 'All', string> = {
  All: 'All',
  Low: 'Low Cost',
  Medium: 'Medium Cost',
  High: 'High Cost',
};

interface CohortData {
  median_revenue: number;
  median_net_pct: number;
  n_entities: number;
  cohort_counts: Record<string, number>;
  cohort_display: Record<string, string>;
  rows: CohortRow[];
}

export function Cohorts({ registerExport }: { registerExport: (fn: ExportFn) => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['cohorts'],
    queryFn: () => api.costToServe('customer', 500),
  });
  const cost = useQuery({ queryKey: ['cost-structure'], queryFn: api.costStructure });
  const [tierFilter, setTierFilter] = useState<Tier | 'All'>('All');

  const tiers = useMemo(() => {
    if (!data || !Array.isArray(data.rows)) return null;
    const { q1, q2 } = tertileCutoffs((data.rows ?? []).map((r) => r.cost_to_serve ?? 0));
    const tierOf = (v: number): CostTier => costTier(v, q1, q2);
    const counts: Record<CostTier, number> = { Low: 0, Medium: 0, High: 0 };
    for (const r of data.rows ?? []) counts[tierOf(r.cost_to_serve ?? 0)] += 1;
    return { tierOf, counts };
  }, [data]);

  useEffect(() => {
    registerExport(() => {
      const rows = (data?.rows ?? []).map((r) => [r.eid, r.label, r.revenue, r.net, r.net_pct, r.cohort, r.cohort_display, r.status_badge]);
      downloadCSV('cohorts.csv', ['id', 'label', 'revenue', 'net', 'net_pct', 'cohort', 'cohort_display', 'badge'], rows);
    });
  }, [registerExport, data]);

  if (isLoading)
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl border border-black/5 bg-white p-3 shadow-card dark:border-white/5 dark:bg-navyCard">
              <div className="skeleton-pulse h-4 w-2/3" />
              <div className="skeleton-pulse mt-2 h-7 w-1/3" />
            </div>
          ))}
        </div>
        <Card title="Loading cohorts…">
          <ChartSkeleton height={420} />
        </Card>
      </div>
    );
  if (error || !data) return <ErrorBlock message={String(error)} />;
  if (!Array.isArray(data.rows) || data.rows.length === 0) return <EmptyBlock message="No cohort data." />;
  return <CohortBody data={data} costQuery={cost} tiers={tiers} tierFilter={tierFilter} setTierFilter={setTierFilter} />;
}

interface CostQuery {
  isLoading: boolean;
  error: unknown;
  data?: {
    totals: { revenue: number; cogs: number; shipping: number; support: number; ret: number; net: number };
    freight_by_bucket: Record<string, number>;
    by_ship_mode: { mode: string; revenue: number; shipping: number; net: number }[];
  };
}

function CohortBody({
  data,
  costQuery,
  tiers,
  tierFilter,
  setTierFilter,
}: {
  data: CohortData;
  costQuery: CostQuery;
  tiers: { tierOf: (v: number) => Tier; counts: Record<Tier, number> } | null;
  tierFilter: Tier | 'All';
  setTierFilter: (t: Tier | 'All') => void;
}) {
  // Normalize once: every downstream .map/.filter/access reads these, never raw data.
  const safeRows = Array.isArray(data.rows) ? data.rows : [];
  const countsMap: Record<string, number> = data.cohort_counts ?? {};
  const displayMap: Record<string, string> = data.cohort_display ?? {};
  const display = (c: string) => displayMap[c] ?? c;
  const rows = tierFilter === 'All' || !tiers ? safeRows : safeRows.filter((r) => tiers.tierOf(r.cost_to_serve ?? 0) === tierFilter);
  const maxAbsPct = Math.max(0.01, ...rows.map((r) => Math.abs(r.net_pct ?? 0)));
  const cost = costQuery as { isLoading: boolean; error: unknown; data?: { totals: { revenue: number; cogs: number; shipping: number; support: number; ret: number; net: number }; freight_by_bucket: Record<string, number>; by_ship_mode: { mode: string; revenue: number; shipping: number; net: number }[] } };
  const pills: (Tier | 'All')[] = ['All', 'Low', 'Medium', 'High'];
  const pillActive: Record<Tier | 'All', string> = {
    All: 'bg-ink text-white shadow dark:bg-neon',
    Low: BADGE_POS,
    Medium: BADGE_WARN,
    High: BADGE_NEG,
  };
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {COHORTS.map((c) => (
          <div key={c} className="rounded-xl border border-black/5 bg-white p-3 shadow-card transition-all duration-175 hover:border-neon/30 hover:shadow-card-hover dark:border-white/5 dark:bg-navyCard dark:hover:border-neon/30">
            <div className="font-display text-sm font-bold text-ink dark:text-white">{display(c)}</div>
            <div className="font-mono text-xs tabular-nums text-slate-400">{c}</div>
            <div className="mt-1 font-display text-xl font-bold tabular-nums" style={{ color: cohortColor(c) }}>
              {(countsMap[c] ?? 0).toLocaleString()}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">customers in full {(data.n_entities ?? 0).toLocaleString()} set</div>
          </div>
        ))}
      </div>
      <Card
        title={`Revenue vs net margin % — 500 customers (medians: ${formatCurrency(data.median_revenue ?? 0)} / ${formatPct(data.median_net_pct ?? 0)})`}
        action={
          <div className="flex gap-1 text-xs">
            {pills.map((p) => (
              <button
                key={p}
                onClick={() => setTierFilter(p)}
                className={`rounded-full px-2.5 py-1 font-semibold transition-all duration-175 ${
                  tierFilter === p
                    ? pillActive[p]
                    : 'border border-slate-200 text-slate-500 hover:shadow dark:border-slate-600 dark:text-slate-300'
                }`}
                title={p === 'All' ? 'Show all cost tiers' : `Isolate ${TIER_PILL_LABEL[p]}-to-serve tier`}
              >
                {p === 'All' ? 'All' : `${TIER_PILL_LABEL[p]} (${tiers?.counts[p] ?? 0})`}
              </button>
            ))}
          </div>
        }
      >
        <ResponsiveContainer width="100%" height={420}>
          <ScatterChart>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis type="number" dataKey="revenue" name="Revenue" tickFormatter={(v: number) => formatCurrency(v)} tick={TICK_PROPS} {...AXIS_PROPS} tickCount={6} />
            <YAxis type="number" dataKey="net_pct" name="Net %" tickFormatter={(v: number) => formatPct(v)} tick={TICK_PROPS} {...AXIS_PROPS} tickCount={6} />
            <ZAxis type="number" dataKey="n_lines" name="Lines" />
            <Tooltip content={<CohortTip />} />
            <ReferenceLine x={data.median_revenue} {...REF_LINE_PROPS} />
            <ReferenceLine y={data.median_net_pct} {...REF_LINE_PROPS} />
            {COHORTS.map((c) => (
              <Scatter key={c} name={`${display(c)} (${c})`} data={rows.filter((r) => r.cohort === c)} fill={cohortColor(c)} />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
        <div className="mt-2 flex flex-wrap gap-3 text-xs">
          {COHORTS.map((c) => (
            <span key={c} className="inline-flex items-center gap-1">
              <span className="inline-block h-3 w-3 rounded-full" style={{ background: cohortColor(c) }} />
              {display(c)} <span className="text-slate-400">({c})</span> ({countsMap[c] ?? 0} in full {(data.n_entities ?? 0).toLocaleString()} set)
            </span>
          ))}
        </div>
        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Relabel is cosmetic only — underlying median-split logic unchanged (D9). Cost tiers split the fetched
          500-customer set into tertiles of cost-to-serve (relative tiers, not fixed cutoffs).
        </div>
      </Card>

      <Card title={`Customers by cost tier (${rows.length} shown)`}>
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white dark:bg-navyCard">
              <tr className="text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <th className="py-2 pr-3">Customer</th>
                <th className="py-2 pr-3">Tier</th>
                <th className="py-2 pr-3 text-right">Revenue</th>
                <th className="py-2 pr-3 text-right">Net</th>
                <th className="py-2 pr-3" style={{ width: '30%' }}>Margin %</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 100).map((r) => {
                const t = tiers?.tierOf(r.cost_to_serve ?? 0) ?? 'Medium';
                return (
                  <tr key={r.eid} className="row-hover border-t border-slate-100 dark:border-slate-700">
                    <td className="max-w-[220px] truncate py-1.5 pr-3 font-medium" title={`${r.label} (${r.eid})`}>
                      {r.label}
                    </td>
                    <td className="py-1.5 pr-3">
                      <span className={TIER_STYLE[t]}>{t}</span>
                    </td>
                    <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{money(r.revenue)}</td>
                    <td className={`py-1.5 pr-3 text-right font-mono tabular-nums ${r.net < 0 ? 'text-neg' : 'text-pos'}`}>{money(r.net)}</td>
                    <td className="py-1.5 pr-3">
                      <MarginBar value={r.net_pct} maxAbs={maxAbsPct} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Showing first 100 of {rows.length}. Green = Low, Yellow = Medium, Red = High cost-to-serve (relative tertiles).</div>
      </Card>

      <Card title="Cost-flow Sankey — gross revenue to net (ship-mode freight split, D10)">
        {cost.isLoading ? (
          <ChartSkeleton height={300} />
        ) : cost.error || !cost.data ? (
          <ErrorBlock message={String(cost.error)} />
        ) : (
          <Sankey totals={cost.data.totals} buckets={cost.data.freight_by_bucket} />
        )}
      </Card>

      <Card title="Cost-to-serve composition across ship modes (same data as Sankey)">
        {cost.isLoading ? (
          <ChartSkeleton height={260} />
        ) : cost.error || !cost.data ? (
          <ErrorBlock message={String(cost.error)} />
        ) : (
          <ShipModeBars modes={cost.data.by_ship_mode} />
        )}
      </Card>

      <FrequencyHeatmapCard />
    </div>
  );
}

function CohortTip(props: { active?: boolean; payload?: { payload: Record<string, number | string> }[] }) {
  if (!props.active || !props.payload?.length) return null;
  const d = props.payload[0].payload;
  return <RichTooltip datum={d as never} label={`${String(d.label ?? '')} (${String(d.cohort ?? '')})`} />;
}

/** Simple 3-stage flow: Revenue -> cost buckets -> Net. Widths ∝ dollars (real data only). */
function Sankey({ totals, buckets }: { totals: { revenue: number; cogs: number; shipping: number; support: number; ret: number; net: number }; buckets: Record<string, number> }) {
  const W = 900;
  const H = 300;
  const rev = totals.revenue || 1;
  const flows = [
    { name: 'COGS', value: totals.cogs, color: COST_COLORS.cogs },
    { name: 'Freight · Standard', value: buckets['Standard Class'] ?? 0, color: COST_COLORS.freightHi },
    { name: 'Freight · 1st+2nd', value: buckets['First+Second Class'] ?? 0, color: COST_COLORS.freight },
    { name: 'Freight · Same Day', value: buckets['Same Day'] ?? 0, color: COST_COLORS.freightLo },
    { name: 'Support', value: totals.support, color: COST_COLORS.support },
    { name: 'Returns', value: totals.ret, color: COST_COLORS.returns },
  ];
  const colX = [10, 340, 670];
  const colW = 220;
  let y = 10;
  const rows = flows.map((f) => {
    const h = Math.max(8, (f.value / rev) * (H - 40));
    const r = { ...f, y, h };
    y += h + 6;
    return r;
  });
  const netH = Math.max(30, (Math.max(totals.net, 0) / rev) * (H - 40));
  const costBottom = rows.length ? rows[rows.length - 1].y + rows[rows.length - 1].h : 10;
  const connMid = 10 + (costBottom - 10) / 2;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        <rect x={colX[0]} y={10} width={colW} height={H - 20} fill="none" stroke="#94A3B8" strokeOpacity={0.3} rx={8} />
        <text x={colX[0] + 8} y={28} fontSize={12} fill="currentColor" className="fill-slate-500">
          Gross Revenue {money(rev)}
        </text>
        {rows.map((r) => (
          <g key={r.name}>
            <polygon
              points={`${colX[0] + colW},${r.y} ${colX[1]},${r.y} ${colX[1]},${r.y + r.h} ${colX[0] + colW},${r.y + r.h}`}
              fill={r.color}
              opacity={0.45}
            />
            <rect x={colX[1]} y={r.y} width={colW} height={r.h} fill={r.color} opacity={0.85}>
              <title>{`${r.name}: ${money(r.value)} (${pct(r.value / rev)})`}</title>
            </rect>
            <text x={colX[1] + 6} y={r.y + Math.min(r.h - 4, 14)} fontSize={11} fill="#fff">
              {r.name} {pct(r.value / rev)}
            </text>
          </g>
        ))}
        <polygon
          points={`${colX[1] + colW},${connMid - 6} ${colX[2]},${10 + 4} ${colX[2]},${10 + netH - 4} ${colX[1] + colW},${connMid + 6}`}
          fill="#94a3b8"
          opacity={0.45}
        >
          <title>Net flow from cost buckets</title>
        </polygon>
        <rect x={colX[2]} y={10} width={colW} height={netH} fill={totals.net >= 0 ? '#10B981' : '#EF4444'} opacity={0.85}>
          <title>{`Net: ${money(totals.net)} (${pct(totals.net / rev)})`}</title>
        </rect>
        <text x={colX[2] + 8} y={10 + Math.min(netH - 6, 18)} fontSize={12} fill="#fff">
          Net {money(totals.net)} ({pct(totals.net / rev)})
        </text>
      </svg>
      <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        Freight split is a Ship Mode proxy, not a literal cost category (D10). Widths proportional to real dollars;
        hover any block for values.
      </div>
    </div>
  );
}

function ShipModeBars({ modes }: { modes: { mode: string; revenue: number; shipping: number; net: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={modes}>
        <CartesianGrid {...GRID_PROPS} />
        <XAxis dataKey="mode" tick={TICK_PROPS} {...AXIS_PROPS} />
        <YAxis tickFormatter={(v: number) => money(v)} tick={TICK_PROPS} {...AXIS_PROPS} tickCount={5} />
        <Tooltip content={<ChartTooltip formatter={(v) => money(Number(v))} />} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="revenue" name="Revenue" fill={COST_COLORS.revenue} />
        <Bar dataKey="shipping" name="Freight" fill={COST_COLORS.freight} />
        <Bar dataKey="net" name="Net">
          {modes.map((m) => (
            <Cell key={m.mode} fill={m.net >= 0 ? '#10B981' : '#EF4444'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function FrequencyHeatmapCard() {
  const freq = useQuery({ queryKey: ['frequency-heatmap'], queryFn: api.frequencyHeatmap });
  if (freq.isLoading) return <Card title="Order frequency × cost tier — customer heatmap (D21)"><ChartSkeleton height={180} /></Card>;
  if (freq.error || !freq.data)
    return <Card title="Order frequency × cost tier — customer heatmap (D21)"><ErrorBlock message={String(freq.error)} /></Card>;
  const bands = freq.data.frequency_bands;
  const tiers = freq.data.tiers;
  const cellOf = (b: string, t: string) => freq.data!.cells.find((c) => c.freq_band === b && c.tier === t);
  return (
    <Card title={`Order frequency × cost tier — ${freq.data.n_customers.toLocaleString()} customers (D21)`}>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <th className="p-1 text-left">Frequency (lines/customer)</th>
              {tiers.map((t) => (
                <th key={t} className="p-1 text-right">{t} cost</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bands.map((b) => (
              <tr key={b} className="border-t border-slate-100 dark:border-slate-700">
                <td className="p-1 font-medium">{b}</td>
                {tiers.map((t) => {
                  const c = cellOf(b, t);
                  return (
                    <td
                      key={t}
                      className="p-1 text-right font-mono tabular-nums"
                      style={{ background: marginCellBg(c?.avg_net_pct) }}
                      title={c ? `${c.n_customers} customers — net ${money(c.net)} (${pct(c.avg_net_pct)}) on ${money(c.revenue)}` : 'no customers'}
                    >
                      {c ? `${c.n_customers} · ${pct(c.avg_net_pct)}` : '—'}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
        Frequency = order-line count per customer; tiers are tertiles of cost-to-serve
        (Low ≤ {money(freq.data.tier_thresholds.low_below)}, Medium ≤ {money(freq.data.tier_thresholds.medium_below)}).
        Σ cells {money(freq.data.total_net_cells)} vs summary {money(freq.data.summary_net)} —{' '}
        {freq.data.reconciles ? 'reconciles ✓' : 'MISMATCH'}. {freq.data.assumption_note}
      </div>
    </Card>
  );
}
