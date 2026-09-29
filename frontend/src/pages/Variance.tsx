import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ExportFn } from '../App';
import { api } from '../api';
import type { KpiPoint } from '../api';
import { Card, ErrorBlock, ChartSkeleton, TableSkeleton, AXIS_PROPS, ChartTooltip, GRID_PROPS, REF_LINE_PROPS, SELECT_CLASS, SUBTAB_ACTIVE, SUBTAB_INACTIVE, TICK_PROPS, downloadCSV, money, pct } from '../components';

type Granularity = 'monthly' | 'quarterly' | 'full';

export function Variance({ registerExport, initialMonth }: { registerExport: (fn: ExportFn) => void; initialMonth: string }) {
  const [month, setMonth] = useState(initialMonth);
  const { data, isLoading, error } = useQuery({
    queryKey: ['variance', month],
    queryFn: () => api.variance(month),
    retry: false,
  });
  const months = useQuery({ queryKey: ['months'], queryFn: api.months });
  const trend = useQuery({ queryKey: ['kpi-trend', 48], queryFn: () => api.kpiTrend(48) });

  useEffect(() => {
    registerExport(() => {
      if (!data) return;
      const rows = data.drivers.map((d) => [data.month, d.component, d.delta_net_dollars]);
      downloadCSV('variance-drivers.csv', ['month', 'component', 'delta_net_dollars'], rows);
    });
  }, [registerExport, data]);

  return (
    <div className="space-y-4">
      <Card
        title="Monthly variance report (Actual vs Prior Month vs Prior Year — no Budget)"
        action={
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className={SELECT_CLASS}
            title="Real YYYY-MM values from the data"
          >
            {(months.data?.months ?? [month]).map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        }
      >
        {isLoading ? (
          <div className="space-y-3">
            <TableSkeleton rows={2} />
            <ChartSkeleton height={220} />
          </div>
        ) : error || !data ? (
          <ErrorBlock message={month === '' ? 'enter a month' : String(error)} />
        ) : (
          <div className="mt-3 space-y-3">
            <p className="rounded-lg bg-slate-50/70 p-3 text-sm leading-relaxed dark:bg-white/[0.02]">{data.narrative}</p>
            <MonthTable data={data} />
            <div>
              <h4 className="mb-1 text-sm font-semibold">Variance bridge — driver attribution (from /variance)</h4>
              <Tornado data={data} />
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">{data.assumption_note}</div>
          </div>
        )}
      </Card>

      <Card title="Drill-down tree — Category → Sub-Category → Product (all-time contribution)">
        <DrillTree />
      </Card>

      <TrendCard trend={trend.data?.points ?? []} isLoading={trend.isLoading} error={trend.error} />
    </div>
  );
}

function MonthTable({ data }: { data: { month: string; previous_month: string; prior_year_month: string | null; current: Record<string, number | string>; previous: Record<string, number | string>; prior_year: Record<string, number | string> | null } }) {
  const num = (r: Record<string, number | string> | null, k: string) => (r ? Number(r[k] ?? 0) : null);
  const rows: [string, number | null, number | null, number | null][] = [
    ['Revenue', num(data.current, 'revenue'), num(data.previous, 'revenue'), num(data.prior_year, 'revenue')],
    ['Net $', num(data.current, 'net'), num(data.previous, 'net'), num(data.prior_year, 'net')],
  ];
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          <th className="py-1">Metric</th>
          <th className="py-1 text-right">Actual ({data.month})</th>
          <th className="py-1 text-right">Prior Month ({data.previous_month})</th>
          <th className="py-1 text-right">Prior Year ({data.prior_year_month ?? 'n/a'})</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([k, a, p, y]) => (
          <tr key={k} className="row-hover border-t border-slate-100 dark:border-slate-700">
            <td className="py-1 font-medium">{k}</td>
            <td className="py-1 text-right font-mono tabular-nums">{a === null ? '—' : money(a)}</td>
            <td className="py-1 text-right font-mono tabular-nums">{p === null ? '—' : money(p)}</td>
            <td className="py-1 text-right font-mono tabular-nums">{y === null ? 'n/a (out of range)' : money(y)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Tornado({ data }: { data: { drivers: { component: string; delta_net_dollars: number }[]; year_over_year: Record<string, number> | null; month: string } }) {
  // Diverging bars: MoM component deltas (drivers) + YoY net delta when available.
  const mom = data.drivers.map((d) => ({ name: `${d.component} (MoM)`, delta: d.delta_net_dollars }));
  const yoy = data.year_over_year ? [{ name: 'Net (YoY)', delta: data.year_over_year.net }] : [];
  const rows = [...mom, ...yoy];
  return (
    <div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={rows} layout="vertical">
          <CartesianGrid {...GRID_PROPS} />
          <XAxis type="number" tickFormatter={(v: number) => money(v)} tick={TICK_PROPS} {...AXIS_PROPS} tickCount={5} />
          <YAxis type="category" dataKey="name" width={110} tick={TICK_PROPS} {...AXIS_PROPS} />
          <Tooltip content={<ChartTooltip formatter={(v) => money(Number(v))} />} />
          <ReferenceLine x={0} {...REF_LINE_PROPS} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="delta" name="Δ net $">
            {rows.map((d) => (
              <Cell key={d.name} fill={d.delta >= 0 ? '#10B981' : '#EF4444'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {!data.year_over_year && (
        <div className="text-xs text-slate-500 dark:text-slate-400">Prior-year bar hidden — {data.month} has no same-month prior year in range (D17).</div>
      )}
    </div>
  );
}

function TrendCard({ trend, isLoading, error }: { trend: KpiPoint[]; isLoading: boolean; error: unknown }) {
  const [gran, setGran] = useState<Granularity>('monthly');
  const pts = useMemo(() => aggregate(trend, gran), [trend, gran]);
  const avgPct = useMemo(
    () => (trend.length ? trend.reduce((s, p) => s + p.net_pct, 0) / trend.length : 0),
    [trend],
  );
  const top = useMemo(() => {
    const s = [...pts].sort((a, b) => Math.abs(b.revDelta) - Math.abs(a.revDelta)).slice(0, 3);
    return new Set(s.map((x) => x.label));
  }, [pts]);
  if (isLoading) return <Card title="Trend — revenue variance vs net margin %"><ChartSkeleton height={260} /></Card>;
  if (error || !trend.length) return <Card title="Trend — revenue variance vs net margin %"><ErrorBlock message={String(error)} /></Card>;
  if (gran === 'full') {
    const t = pts[0];
    return (
      <Card
        title="Full-period aggregate (historical — no YTD)"
        action={<GranToggle gran={gran} setGran={setGran} />}
      >
        <div className="grid grid-cols-3 gap-3 text-center">
          <div><div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Revenue</div><div className="font-display text-xl font-bold tabular-nums">{money(t.revenue)}</div></div>
          <div><div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Net $</div><div className={`font-display text-xl font-bold tabular-nums ${t.net < 0 ? 'text-neg' : 'text-pos'}`}>{money(t.net)}</div></div>
          <div><div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Net %</div><div className={`font-display text-xl font-bold tabular-nums ${t.netPct < 0 ? 'text-neg' : 'text-pos'}`}>{pct(t.netPct)}</div></div>
        </div>
        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Sums/means over all 48 months from /kpi-trend — the same monthly data, aggregated.</div>
      </Card>
    );
  }
  return (
    <Card
      title={`Trend — revenue variance (bars) vs net margin % (line), ${gran}`}
      action={<GranToggle gran={gran} setGran={setGran} />}
    >
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={pts}>
          <CartesianGrid {...GRID_PROPS} />
          <XAxis dataKey="label" tick={TICK_PROPS} {...AXIS_PROPS} interval={gran === 'monthly' ? 5 : 0} minTickGap={8} />
          <YAxis yAxisId="d" tickFormatter={(v: number) => money(v)} width={70} tick={TICK_PROPS} {...AXIS_PROPS} tickCount={5} />
          <YAxis yAxisId="p" orientation="right" tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`} domain={['auto', 'auto']} tick={TICK_PROPS} {...AXIS_PROPS} tickCount={5} />
          <Tooltip content={<TrendTip top={top} />} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <ReferenceLine yAxisId="p" y={avgPct} stroke="#8B5CF6" strokeDasharray="6 3" strokeOpacity={0.7} label={{ value: `avg ${pct(avgPct)}`, fontSize: 11 }} />
          <Bar yAxisId="d" dataKey="revDelta" name="Revenue Δ vs prior period">
            {pts.map((p) => (
              <Cell key={p.label} fill={top.has(p.label) ? (p.revDelta >= 0 ? '#059669' : '#dc2626') : p.revDelta >= 0 ? '#a7f3d0' : '#fecaca'} />
            ))}
          </Bar>
          <Line yAxisId="p" type="monotone" dataKey="netPct" name="Net margin %" stroke="#3B82F6" strokeWidth={2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        Purple dashed line = overall average net margin % across all months (computed from /kpi-trend, not a target).
        Highlighted bars = 3 largest absolute revenue variances — hover for callouts. Aggregated from existing monthly
        data; no YTD (historical only).
      </div>
    </Card>
  );
}

function GranToggle({ gran, setGran }: { gran: Granularity; setGran: (g: Granularity) => void }) {
  return (
    <div className="no-print inline-flex rounded-xl border border-black/5 bg-slate-100 p-0.5 text-xs dark:border-white/5 dark:bg-slate-900">
      {(['monthly', 'quarterly', 'full'] as Granularity[]).map((g) => (
        <button
          key={g}
          onClick={() => setGran(g)}
          className={`rounded-lg px-2.5 py-1 font-semibold capitalize transition-all duration-175 ${gran === g ? SUBTAB_ACTIVE : SUBTAB_INACTIVE}`}
        >
          {g === 'full' ? 'Full Period' : g}
        </button>
      ))}
    </div>
  );
}

interface AggPt {
  label: string;
  revenue: number;
  net: number;
  netPct: number;
  revDelta: number;
}

/** Aggregate existing monthly /kpi-trend points — no new endpoint, no invented periods. */
function aggregate(trend: KpiPoint[], gran: Granularity): AggPt[] {
  if (gran === 'monthly') {
    return trend.map((p, i) => ({
      label: p.month,
      revenue: p.revenue,
      net: p.net,
      netPct: p.net_pct,
      revDelta: i === 0 ? 0 : p.revenue - trend[i - 1].revenue,
    }));
  }
  if (gran === 'quarterly') {
    const buckets = new Map<string, KpiPoint[]>();
    for (const p of trend) {
      const q = `${p.month.slice(0, 4)}-Q${Math.floor((Number(p.month.slice(5, 7)) - 1) / 3) + 1}`;
      const arr = buckets.get(q) ?? [];
      arr.push(p);
      buckets.set(q, arr);
    }
    const out: AggPt[] = [...buckets.entries()].map(([label, ps]) => {
      const revenue = ps.reduce((s, x) => s + x.revenue, 0);
      const net = ps.reduce((s, x) => s + x.net, 0);
      return { label, revenue, net, netPct: revenue ? net / revenue : 0, revDelta: 0 };
    });
    out.forEach((o, i) => {
      o.revDelta = i === 0 ? 0 : o.revenue - out[i - 1].revenue;
    });
    return out;
  }
  const revenue = trend.reduce((s, p) => s + p.revenue, 0);
  const net = trend.reduce((s, p) => s + p.net, 0);
  return [{ label: 'Full period', revenue, net, netPct: revenue ? net / revenue : 0, revDelta: 0 }];
}

function TrendTip(props: { active?: boolean; payload?: { payload: AggPt }[]; label?: string; top?: Set<string> }) {
  if (!props.active || !props.payload?.length) return null;
  const p = props.payload[0].payload;
  const star = props.top?.has(p.label) ? ' ★ largest variance' : '';
  return (
    <div className="rounded-xl border border-black/5 bg-white px-3 py-2 text-xs shadow-card-hover dark:border-white/10 dark:bg-navyCard dark:shadow-card-hover-dark dark:text-slate-100">
      <div className="mb-1 font-display font-semibold text-ink dark:text-white">{p.label}{star}</div>
                <div className="flex justify-between gap-4 py-px"><span className="text-slate-500 dark:text-slate-400">Revenue Δ</span><span className="font-mono font-semibold tabular-nums">{money(p.revDelta)}</span></div>
                <div className="flex justify-between gap-4 py-px"><span className="text-slate-500 dark:text-slate-400">Revenue</span><span className="font-mono tabular-nums">{money(p.revenue)}</span></div>
                <div className="flex justify-between gap-4 py-px"><span className="text-slate-500 dark:text-slate-400">Net %</span><span className="font-mono tabular-nums">{pct(p.netPct)}</span></div>
    </div>
  );
}

function DrillTree() {
  const [cat, setCat] = useState<string | null>(null);
  const [sub, setSub] = useState<string | null>(null);
  const cats = useQuery({ queryKey: ['drill-tree'], queryFn: () => api.drillTree() });
  const subs = useQuery({ queryKey: ['drill-tree', cat], queryFn: () => api.drillTree(cat!), enabled: !!cat });
  const prods = useQuery({
    queryKey: ['drill-tree', cat, sub],
    queryFn: () => api.drillTree(cat!, sub!, 20),
    enabled: !!cat && !!sub,
  });
  if (cats.isLoading) return <ChartSkeleton height={180} />;
  if (cats.error || !cats.data) return <ErrorBlock message={String(cats.error)} />;
  return (
    <div className="space-y-2 text-sm">
      {cats.data.children.map((c) => (
        <div key={c.name} className="rounded-lg border border-black/5 dark:border-white/5">
          <button
            onClick={() => {
              setCat(cat === c.name ? null : c.name!);
              setSub(null);
            }}
            className="row-hover flex w-full items-center justify-between rounded-lg p-2 text-left"
          >
            <span className="font-semibold">
              <span className="mr-1 inline-block w-4 text-slate-400">{cat === c.name ? '▾' : '▸'}</span>
              {c.name}
            </span>
            <span className={`font-mono font-bold tabular-nums ${c.net < 0 ? 'text-neg' : 'text-pos'}`}>{money(c.net)}</span>
          </button>
          {cat === c.name && (
            <div className="border-t border-black/5 pl-4 dark:border-white/5">
              {subs.isLoading ? (
                <TableSkeleton rows={4} />
              ) : subs.error || !subs.data ? (
                <ErrorBlock message={String(subs.error)} />
              ) : (
                subs.data.children.map((s) => (
                  <div key={s.name} className="border-b border-black/5 last:border-b-0 dark:border-white/5">
                    <button
                      onClick={() => setSub(sub === s.name ? null : s.name!)}
                      className="row-hover flex w-full items-center justify-between p-2 text-left"
                    >
                      <span>
                        <span className="mr-1 inline-block w-4 text-slate-400">{sub === s.name ? '▾' : '▸'}</span>
                        {s.name}{' '}
                        <span className="font-mono text-xs tabular-nums text-slate-400">
                          ({s.share_of_parent !== undefined ? `${(s.share_of_parent * 100).toFixed(1)}% of parent` : ''})
                        </span>
                      </span>
                      <span className={`font-mono tabular-nums ${s.net < 0 ? 'text-neg' : 'text-pos'}`}>{money(s.net)}</span>
                    </button>
                    {sub === s.name && (
                      <div className="pb-2 pl-4">
                        {prods.isLoading ? (
                          <TableSkeleton rows={5} />
                        ) : prods.error || !prods.data ? (
                          <ErrorBlock message={String(prods.error)} />
                        ) : (
                          <div className="text-xs">
                            <div className="mb-1 text-slate-500 dark:text-slate-400">
                              Worst-first products ({prods.data.n_products_total} total, showing {prods.data.children.length})
                            </div>
                            {prods.data.children.map((p) => (
                              <div key={p.pid} className="flex items-center justify-between py-0.5">
                                <span className="truncate" title={p.label}>
                                  {p.label}
                                </span>
                                <span className={`font-mono tabular-nums ${p.net < 0 ? 'text-neg' : 'text-pos'}`}>{money(p.net)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      ))}
      <div className="text-xs text-slate-500 dark:text-slate-400">
        Children net sums equal the parent net (test-asserted). All-time dollars; monthly slicing stays in the
        Variance report above.
      </div>
    </div>
  );
}
