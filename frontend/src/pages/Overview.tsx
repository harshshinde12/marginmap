import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ExportFn } from '../App';
import { api } from '../api';
import { formatCurrency, formatPct } from '../format';
import { Card, ErrorBlock, LoadingBlock, RichTooltip, Sparkline, downloadCSV, money } from '../components';
import { useQuery as useQ } from '@tanstack/react-query';

export function Overview({ registerExport }: { registerExport: (fn: ExportFn) => void }) {
  const cat = useQuery({ queryKey: ['prof-cat'], queryFn: () => api.profitability('category') });
  const reg = useQuery({ queryKey: ['prof-region'], queryFn: () => api.profitability('region') });
  const cost = useQuery({ queryKey: ['cost-structure'], queryFn: api.costStructure });

  useEffect(() => {
    registerExport(() => {
      const rows = (cat.data?.rows ?? []).map((r) => [r.label, r.sales, r.cogs, r.shipping, r.support, r.return_cost, r.net, r.net_pct]);
      downloadCSV('overview-by-category.csv', ['category', 'revenue', 'cogs', 'shipping', 'support', 'return_cost', 'net', 'net_pct'], rows);
    });
  }, [registerExport, cat.data]);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Profit waterfall — list price to net (display-only)">
          {cost.isLoading ? (
            <LoadingBlock />
          ) : cost.error || !cost.data ? (
            <ErrorBlock message={String(cost.error)} />
          ) : (
            <Waterfall totals={cost.data.totals} />
          )}
        </Card>
        <Card title="Cost structure — buckets as % of effective revenue">
          {cost.isLoading ? (
            <LoadingBlock />
          ) : cost.error || !cost.data ? (
            <ErrorBlock message={String(cost.error)} />
          ) : (
            <Donut totals={cost.data.totals} />
          )}
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <DriverCards kind="drivers" />
        <DriverCards kind="drainers" />
      </div>
      <TreemapCard />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Net margin % by category">
          {cat.isLoading ? (
            <LoadingBlock />
          ) : cat.error || !cat.data ? (
            <ErrorBlock message={String(cat.error)} />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={cat.data.rows} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`} />
                <YAxis type="category" dataKey="label" width={120} />
                <Tooltip content={<CatTip />} />
                <ReferenceLine x={0} stroke="#0f172a" />
                <Bar dataKey="net_pct" name="Net margin %">
                  {cat.data.rows.map((r) => (
                    <Cell key={r.grp} fill={r.net_pct >= 0 ? '#10B981' : '#EF4444'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
        <Card title="Net margin by region (USD)">
          {reg.isLoading ? (
            <LoadingBlock />
          ) : reg.error || !reg.data ? (
            <ErrorBlock message={String(reg.error)} />
          ) : reg.data.rows.length === 0 ? (
            <div className="text-sm text-slate-500 dark:text-slate-400">No regions returned.</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={reg.data.rows.slice(0, 12)} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" tickFormatter={(v: number) => formatCurrency(v)} />
                <YAxis type="category" dataKey="label" width={130} />
                <Tooltip content={<CatTip />} />
                <ReferenceLine x={0} stroke="#0f172a" />
                <Bar dataKey="net" name="Net margin">
                  {reg.data.rows.slice(0, 12).map((r) => (
                    <Cell key={r.grp} fill={r.net >= 0 ? '#10B981' : '#EF4444'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>
    </div>
  );
}

function CatTip(props: { active?: boolean; payload?: { payload: Record<string, number | string> }[]; label?: string }) {
  if (!props.active || !props.payload?.length) return null;
  const d = props.payload[0].payload;
  return <RichTooltip datum={d as never} label={String(d.label ?? d.grp ?? '')} />;
}

/** Compact axis currency ($0, $5M, $10M, -$2.5M) so Y ticks fit their lane; tooltips keep full precision. */
export function compactMoney(v: number): string {
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (a >= 1_000_000) {
    const m = a / 1_000_000;
    return `${sign}$${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  if (a >= 1_000) {
    const k = a / 1_000;
    return `${sign}$${Number.isInteger(k) ? k : k.toFixed(1)}K`;
  }
  return `${sign}$${Math.round(a)}`;
}

function Waterfall({ totals }: { totals: { revenue: number; cogs: number; shipping: number; support: number; ret: number; net: number; list_price: number } }) {
  // Display-only bridge (D6): list price -> costs -> net. Locked formulas untouched.
  const steps = [
    { name: 'List Price', delta: totals.list_price, run: totals.list_price },
    { name: 'Discount', delta: totals.revenue - totals.list_price, run: totals.revenue },
    { name: 'COGS', delta: -totals.cogs, run: totals.revenue - totals.cogs },
    { name: 'Freight', delta: -totals.shipping, run: totals.revenue - totals.cogs - totals.shipping },
    { name: 'Support', delta: -totals.support, run: totals.revenue - totals.cogs - totals.shipping - totals.support },
    { name: 'Returns', delta: -totals.ret, run: totals.net },
    { name: 'Net', delta: 0, run: totals.net, total: true },
  ];
  const data = steps.map((s) => ({
    ...s,
    base: s.total ? 0 : Math.min(s.run, s.run - s.delta),
    size: s.total ? s.run : Math.abs(s.delta),
  }));
  return (
    <div>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 5, right: 10, left: 70, bottom: 20 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" interval={0} angle={-45} dy={14} height={80} tick={{ fontSize: 10 }} />
          <YAxis tickFormatter={(v: number) => compactMoney(v)} width={80} />
          <Tooltip content={<FallTip />} />
          <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
          <Bar dataKey="size" stackId="w" name="Step">
            {data.map((s) => (
              <Cell key={s.name} fill={s.total ? (s.run >= 0 ? '#3B82F6' : '#EF4444') : s.delta >= 0 ? '#10B981' : '#EF4444'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="mt-1 text-xs text-slate-500 dark:text-[13px] dark:text-slate-400">
        List price = Σ sales_effective / (1 − Discount), display-only (D6). Final Net {money(totals.net)} reconciles to
        the Phase 1 summary.
      </div>
    </div>
  );
}

function FallTip(props: { active?: boolean; payload?: { payload: { name: string; delta: number; run: number } }[] }) {  if (!props.active || !props.payload?.length) return null;
  const s = props.payload[0].payload;
  return (
    <div className="rounded border border-slate-200 bg-white p-2 text-xs shadow-lg dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100">
      <div className="mb-1 font-semibold">{s.name}</div>
      <div className="flex justify-between gap-4"><span className="text-slate-500 dark:text-slate-400">Step</span><span className="font-mono font-semibold">{money(s.delta)}</span></div>
      <div className="flex justify-between gap-4"><span className="text-slate-500 dark:text-slate-400">Running total</span><span className="font-mono font-semibold">{money(s.run)}</span></div>
    </div>
  );
}

function Donut({ totals }: { totals: { revenue: number; cogs: number; shipping: number; support: number; ret: number; net: number } }) {
  const rev = totals.revenue || 1;
  const slices = [
    { name: 'COGS', value: totals.cogs, pct: (totals.cogs / rev) * 100 },
    { name: 'Freight', value: totals.shipping, pct: (totals.shipping / rev) * 100 },
    { name: 'Support', value: totals.support, pct: (totals.support / rev) * 100 },
    { name: 'Returns', value: totals.ret, pct: (totals.ret / rev) * 100 },
  ];
  const colors = ['#3B82F6', '#8B5CF6', '#f59e0b', '#64748b'];
  const net = totals.net;
  const [active, setActive] = useState<number | null>(null);
  const a = active !== null ? slices[active] : null;
  return (
    <div>
      <div className="relative">
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="name"
            innerRadius="55%"
              outerRadius="92%"
              onMouseEnter={(_, i) => setActive(i)}
              onMouseLeave={() => setActive(null)}
              isAnimationActive={false}
            >
              {slices.map((s, i) => (
                <Cell key={s.name} fill={colors[i % colors.length]} opacity={active === null || active === i ? 1 : 0.45} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        {a && (
          <div
            className="absolute right-2 top-2 z-50 rounded border border-slate-200 bg-white p-3 text-xs shadow-lg dark:border-slate-600 dark:bg-slate-900"
            style={{ boxShadow: '0 8px 24px rgba(0,0,0,0.18)', pointerEvents: 'none' }}
          >
            <div className="mb-1 font-semibold text-ink dark:text-white">{a.name}</div>
            <div className="flex justify-between gap-4">
              <span className="text-slate-500 dark:text-slate-400">Cost $</span>
              <span className="font-mono font-semibold">{money(a.value)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-slate-500 dark:text-slate-400">% of revenue</span>
              <span className="font-mono font-semibold">{a.pct.toFixed(1)}%</span>
            </div>
          </div>
        )}
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Net margin</div>
          <div className={`font-display text-lg font-bold ${net < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{money(net)}</div>
          <div className={`font-mono text-xs font-medium ${net < 0 ? 'text-rose-500 dark:text-rose-400' : 'text-emerald-500 dark:text-emerald-400'}`}>
            {formatPct(net / (totals.revenue || 1))}
          </div>
        </div>
      </div>
      <div className="mt-3 grid w-full grid-cols-2 gap-2 lg:grid-cols-4">
        {slices.map((s, i) => (
          <div
            key={s.name}
            className="rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: colors[i % colors.length] }}
              />
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">{s.name}</span>
            </div>
            <div className="mt-1 font-mono text-sm font-semibold text-ink dark:text-white">{s.pct.toFixed(1)}% <span className="font-normal text-slate-500 dark:text-slate-400">of revenue</span></div>
            <div className="overflow-visible whitespace-nowrap font-display text-sm font-bold text-slate-900 dark:text-white">{money(s.value)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DriverCards({ kind }: { kind: 'drivers' | 'drainers' }) {
  const loss = useQ({ queryKey: ['loss-product-200'], queryFn: () => api.lossMakers('product', 200) });
  const prof = useQ({ queryKey: ['prof-product-all'], queryFn: () => api.profitability('product', 20000) });
  if (loss.isLoading || prof.isLoading) return <LoadingBlock />;
  if (loss.error || prof.error || !loss.data || !prof.data)
    return <ErrorBlock message={String(loss.error ?? prof.error)} />;
  const items =
    kind === 'drainers'
      ? loss.data.rows.slice(0, 3).map((r) => ({ id: r.eid, label: r.label, net: r.net }))
      : [...prof.data.rows].sort((a, b) => b.net - a.net).slice(0, 3).map((r) => ({ id: r.grp, label: r.label, net: r.net }));
  return (
    <Card title={kind === 'drivers' ? 'Top 3 profit drivers' : 'Top 3 margin drainers'}>
      <div className="space-y-2">
        {items.map((it) => (
          <DriverRow key={it.id} id={it.id} label={it.label} net={it.net} />
        ))}
      </div>
      <div className="mt-2 text-xs text-slate-500 dark:text-[13px] dark:text-slate-400">
        Sparklines trace monthly net $ trend direction (green = ends higher, red = ends lower) — not the sign of the $ value.
      </div>
    </Card>
  );
}

function DriverRow({ id, label, net }: { id: string; label: string; net: number }) {
  const trend = useQ({ queryKey: ['entity-trend', 'product', id], queryFn: () => api.entityTrend('product', id) });
  const vals = (trend.data?.points ?? []).map((p) => p.net);
  return (
    <div className="row-hover flex items-center gap-3 rounded border border-slate-100 p-2 dark:border-slate-700">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{label}</div>
        <div className="text-xs text-slate-500 dark:text-[13px] dark:text-slate-400">{id}</div>
      </div>
      <Sparkline values={vals} width={100} height={28} />
      <div className={`font-display text-sm font-bold ${net < 0 ? 'text-neg' : 'text-pos'}`}>{money(net)}</div>
    </div>
  );
}

function TreemapCard() {
  const tree = useQ({ queryKey: ['treemap'], queryFn: api.treemap });
  if (tree.isLoading) return <Card title="Revenue treemap — Category → Sub-Category (D20)"><LoadingBlock /></Card>;
  if (tree.error || !tree.data)
    return <Card title="Revenue treemap — Category → Sub-Category (D20)"><ErrorBlock message={String(tree.error)} /></Card>;
  const totalRev = tree.data.nodes.reduce((s, n) => s + (n.revenue || 0), 0) || 1;
  const bg = (v: number) => {
    const t = Math.min(1, Math.abs(v) / 0.3);
    return v >= 0 ? `rgba(16,185,129,${0.25 + 0.55 * t})` : `rgba(239,68,68,${0.25 + 0.55 * t})`;
  };
  return (
    <Card title="Revenue treemap — Category → Sub-Category (sizes = effective revenue, color = net %)">
      <div className="flex flex-col gap-2 md:flex-row">
        {tree.data.nodes.map((c) => (
          <div key={c.name} className="min-w-0 flex-1 rounded-lg border border-slate-200 p-2 dark:border-slate-700" style={{ flexGrow: Math.max(1, c.revenue / totalRev) * 10 }}>
            <div className="mb-1 truncate text-sm font-bold" title={`${c.name} — ${money(c.revenue)} revenue, ${money(c.net)} net (${formatPct(c.net_pct)})`}>
              {c.name} <span className="font-normal text-slate-500 dark:text-slate-400">({money(c.net)})</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {(c.children ?? []).map((k) => {
                const w = Math.max(8, (k.revenue / (c.revenue || 1)) * 100);
                return (
                  <div
                    key={k.name}
                    className="rounded p-1.5 text-[11px] leading-tight text-white"
                    style={{ background: bg(k.net_pct), width: `${w}%`, minWidth: 90, flexGrow: 1 }}
                    title={`${k.name} — revenue ${money(k.revenue)}, net ${money(k.net)} (${formatPct(k.net_pct)}), ${k.n_lines} lines`}
                  >
                    <div className="truncate font-semibold">{k.name}</div>
                    <div className="font-mono">{formatPct(k.net_pct)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 text-xs text-slate-500 dark:text-[13px] dark:text-slate-400">
        Sizes by effective revenue, colors by net margin % (emerald positive, red negative). Σ nets {money(tree.data.total_net_cells)} vs
        summary {money(tree.data.summary_net)} — {tree.data.reconciles ? 'reconciles ✓' : 'MISMATCH'} (D20).
      </div>
    </Card>
  );
}
