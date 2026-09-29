import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ExportFn } from '../App';
import { LossRow, api } from '../api';
import { paretoPoints, suggestionForTag, tagDistribution } from '../addon-helpers';
import { formatCurrency, formatPct } from '../format';
import { Card, Drawer, EmptyBlock, ErrorBlock, ChartSkeleton, TableSkeleton, BADGE_NEG, BADGE_POS, BADGE_WARN, AXIS_PROPS, ChartTooltip, GRID_PROPS, SELECT_CLASS, SUBTAB_ACTIVE, SUBTAB_INACTIVE, TICK_PROPS, downloadCSV, money, pct, printPDF } from '../components';

const DRIVER_LABEL: Record<string, string> = {
  freight: 'freight',
  support: 'support',
  returns: 'return fees',
};

const BADGE_STYLE: Record<string, string> = {
  Critical: BADGE_NEG,
  Moderate: BADGE_WARN,
  Warning: BADGE_WARN,
  Healthy: BADGE_POS,
};

const DIMS = ['product', 'customer', 'region'] as const;
type Dim = (typeof DIMS)[number];
type SortKey = 'net' | 'net_pct';

export function LossMakers({
  registerExport,
  onSimulate,
}: {
  registerExport: (fn: ExportFn) => void;
  onSimulate: (dimension: string, entityId: string) => void;
}) {
  const [dimension, setDimension] = useState<Dim>('product');
  const [sortKey, setSortKey] = useState<SortKey>('net');
  const [openId, setOpenId] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ['loss', dimension],
    queryFn: () => api.lossMakers(dimension, 30),
  });
  // Badge cutoffs live from the API (D11) — formatted at render time, never hardcoded.
  const cutoffs = useQuery({
    queryKey: ['badge-cutoffs'],
    queryFn: () => api.costToServe('product', 1),
  });

  const rows = useMemo(() => {
    const rs = Array.isArray(data?.rows) ? [...data.rows] : [];
    return sortKey === 'net' ? rs.sort((a, b) => a.net - b.net) : rs.sort((a, b) => a.net_pct - b.net_pct);
  }, [data, sortKey]);

  const exportCSV = () => {
    const rs = rows.map((r) => [r.eid, r.label, r.revenue, r.net, r.net_pct, r.status_badge, r.tags.map((t) => t.label).join(' | '), r.driver ?? '', r.driver_share]);
    downloadCSV(`loss-makers-${dimension}.csv`, ['id', 'label', 'revenue', 'net', 'net_pct', 'badge', 'tags', 'driver', 'driver_share'], rs);
  };

  useEffect(() => {
    registerExport(exportCSV);
  });

  if (isLoading)
    return (
      <Card title="Loading loss-makers…">
        <TableSkeleton rows={6} />
      </Card>
    );
  if (error || !data) return <ErrorBlock message={String(error)} />;
  if (!Array.isArray(data.rows) || data.rows.length === 0) return <EmptyBlock message="No loss-makers. Good news." />;
  const open = openId ? data.rows.find((r) => r.eid === openId) ?? null : null;
  return (
    <div className="space-y-3">
      <div className="no-print inline-flex rounded-xl border border-black/5 bg-slate-100 p-1 dark:border-white/5 dark:bg-slate-900">
        {DIMS.map((d) => (
          <button
            key={d}
            onClick={() => {
              setDimension(d);
              setOpenId(null);
            }}
            className={`rounded-lg px-4 py-1.5 text-sm font-semibold capitalize transition-all duration-175 ${
              dimension === d ? SUBTAB_ACTIVE : SUBTAB_INACTIVE
            }`}
          >
            {d === 'product' ? 'Products' : d === 'customer' ? 'Customers' : 'Regions'}
          </button>
        ))}
      </div>
      <Card
        title={`Worst loss-makers — ${dimension} (${data.n_loss_makers.toLocaleString()} total with net < $0)`}
        action={
          <div className="no-print flex items-center gap-1 text-xs">
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className={SELECT_CLASS}
              style={{ height: 32 }}
              title="Client-side sort"
            >
              <option value="net">Sort: Net $ loss</option>
              <option value="net_pct">Sort: Margin %</option>
            </select>
            <button onClick={exportCSV} className="h-8 rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold shadow-sm transition-all duration-175 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-neon/40 dark:border-slate-700 dark:hover:bg-navyCardHover" title="Download these rows as CSV">
              CSV ↓
            </button>
          </div>
        }
      >
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((r) => (
            <article key={r.eid} className="rounded-xl border border-black/5 bg-white p-3 shadow-card transition-all duration-175 hover:border-neon/30 hover:shadow-card-hover dark:border-white/5 dark:bg-navyCard dark:hover:border-neon/30">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium" title={`${r.label} (${r.eid})`}>{r.label}</div>
                  <div className="font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
                    {r.eid} · revenue {formatCurrency(r.revenue)} · {r.n_lines} lines
                  </div>
                </div>
                <span className={`shrink-0 ${BADGE_STYLE[r.status_badge] ?? ''}`}>
                  {r.status_badge}
                </span>
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="font-display text-xl font-bold tabular-nums text-neg">{formatCurrency(r.net)}</span>
                <span className="font-mono text-sm tabular-nums text-neg">{formatPct(r.net_pct)}</span>
              </div>
              <div className="mt-1 text-xs">
                <span className="font-semibold">Top cause: </span>
                {r.tags.length > 0 ? (
                  <span className="rounded-lg bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-navyCardHover">{r.tags[0].label}</span>
                ) : (
                  <span className="text-slate-400">none fired</span>
                )}
                {r.tags.length > 1 && <span className="ml-1 text-slate-400">+{r.tags.length - 1} more</span>}
              </div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Biggest cost driver: {DRIVER_LABEL[r.driver ?? ''] ?? r.driver} ({formatPct(r.driver_share)} of cost-to-serve)
              </div>
              <div className="no-print mt-2 flex gap-2">
                <button
                  onClick={() => setOpenId(r.eid)}
                  className="h-9 flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-sm font-semibold shadow-sm transition-all duration-175 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-neon/40 dark:border-slate-700 dark:hover:bg-navyCardHover"
                >
                  View Details
                </button>
                <button
                  onClick={() => onSimulate(dimension, r.eid)}
                  className="h-9 flex-1 rounded-lg bg-ink px-2 py-1.5 text-sm font-semibold text-white shadow-sm transition-all duration-175 hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-neon/40 dark:bg-neon"
                  title="Open the real Pricing Simulator pre-loaded with this entity"
                >
                  Simulate Price Hike →
                </button>
              </div>
            </article>
          ))}
        </div>
        <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Badges use quartile-derived cutoffs
          {cutoffs.data?.badge_cutoffs
            ? ` (Critical below ${formatPct(cutoffs.data.badge_cutoffs.critical_below)}, Moderate to ${formatPct(cutoffs.data.badge_cutoffs.moderate_below)}, Warning to 0%)`
            : ' (…)'} — not round
          numbers (D11). Tags show measured values (D12).
        </div>
      </Card>
      {open && <EntityDrawer row={open} dimension={dimension} onClose={() => setOpenId(null)} />}
      <ParetoCard rows={rows} />
      <DistributionCard rows={rows} />
    </div>
  );
}

function EntityDrawer({ row, dimension, onClose }: { row: LossRow; dimension: string; onClose: () => void }) {
  const trend = useQuery({ queryKey: ['entity-trend', dimension, row.eid], queryFn: () => api.entityTrend(dimension, row.eid) });
  const flags = useQuery({ queryKey: ['flags', dimension, row.eid], queryFn: () => api.flags({ entity_type: dimension, entity_id: row.eid }) });
  const [note, setNote] = useState('');
  const [flagMsg, setFlagMsg] = useState('');
  const [flagging, setFlagging] = useState(false);

  const submitFlag = async () => {
    setFlagging(true);
    setFlagMsg('');
    try {
      await api.createFlag(dimension, row.eid, note);
      setNote('');
      setFlagMsg('Flagged for review ✓');
      flags.refetch();
    } catch (e) {
      setFlagMsg(`Flag failed: ${String(e)}`);
    } finally {
      setFlagging(false);
    }
  };

  const exportEntity = () => {
    downloadCSV(
      `sales-team-${row.eid}.csv`,
      ['entity_id', 'label', 'revenue', 'cogs', 'shipping', 'support', 'return_cost', 'net', 'net_pct', 'badge'],
      [[row.eid, row.label, row.revenue, row.cogs, row.shipping, row.support, row.return_cost, row.net, row.net_pct, row.status_badge]],
    );
  };

  return (
    <Drawer title={`${row.label} (${row.eid})`} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <div>
          <h4 className="text-sm font-semibold">Monthly history (net $)</h4>
          {trend.isLoading ? (
            <ChartSkeleton height={180} />
          ) : trend.error || !trend.data ? (
            <ErrorBlock message={String(trend.error)} />
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={trend.data.points}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="month" tick={TICK_PROPS} {...AXIS_PROPS} interval={Math.max(0, Math.floor(trend.data.points.length / 6) - 1)} />
                <YAxis tickFormatter={(v: number) => money(v)} width={60} tick={TICK_PROPS} {...AXIS_PROPS} tickCount={5} />
                <Tooltip content={<ChartTooltip formatter={(v) => money(Number(v))} />} />
                <Line type="monotone" dataKey="net" stroke="#EF4444" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
        <div>
          <h4 className="text-sm font-semibold">Full cost breakdown</h4>
          <CostTable row={row} />
        </div>
        <div>
          <h4 className="text-sm font-semibold">Root-cause tags</h4>
          {row.tags.length === 0 ? (
            <div className="text-slate-500 dark:text-slate-400">No tags fire for this entity.</div>
          ) : (
            <ul className="list-disc pl-5">
              {row.tags.map((t) => (
                <li key={t.key}>
                  {t.label}
                  {suggestionForTag(t.key) && (
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      Rule-based suggestion: {suggestionForTag(t.key)}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h4 className="text-sm font-semibold">Flag for Review (persisted)</h4>
          <div className="flex gap-2">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note (optional)"
              className="h-9 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-sm shadow-sm transition-all duration-175 focus:outline-none focus:ring-2 focus:ring-neon/40 dark:border-slate-700 dark:bg-navyCard"
            />
            <button disabled={flagging} onClick={submitFlag} className="h-9 rounded-lg bg-ink px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition-all duration-175 hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-neon/40 disabled:opacity-50 dark:bg-neon">
              {flagging ? '…' : 'Flag'}
            </button>
          </div>
          {flagMsg && <div className="mt-1 text-xs">{flagMsg}</div>}
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {flags.data ? `${flags.data.n_flags} flag(s) on this entity` : '…'}
            {flags.data?.flags.map((f) => (
              <div key={f.id}>#{f.id} [{f.status}] {f.note} · {f.flagged_at}</div>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={exportEntity} className="h-9 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold shadow-sm transition-all duration-175 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-neon/40 dark:border-slate-700 dark:hover:bg-navyCardHover">
            Export to Sales Team (CSV)
          </button>
          <button onClick={printPDF} className="h-9 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold shadow-sm transition-all duration-175 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-neon/40 dark:border-slate-700 dark:hover:bg-navyCardHover">
            Export to Sales Team (PDF)
          </button>
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400">
          Rule-based suggestions only (fixed text per tag, no forecasts or savings estimates) — plus measured tags,
          Flag and Export (D27).
        </div>
      </div>
    </Drawer>
  );
}

function CostTable({ row }: { row: LossRow }) {
  const rows: [string, number][] = [
    ['Revenue (effective)', row.revenue],
    ['COGS', row.cogs],
    ['Freight', row.shipping],
    ['Support', row.support],
    ['Return cost', row.return_cost],
    ['Net', row.net],
  ];
  return (
    <table className="w-full text-sm">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k} className="border-t border-slate-100 dark:border-slate-700">
            <td className="py-1 text-slate-500 dark:text-slate-400">{k}</td>
            <td className={`py-1 text-right font-mono tabular-nums ${k === 'Net' && v < 0 ? 'font-bold text-neg' : ''}`}>{money(v)}</td>
          </tr>
        ))}
        <tr className="border-t border-slate-100 dark:border-slate-700">
          <td className="py-1 text-slate-500 dark:text-slate-400">Net %</td>
          <td className="py-1 text-right font-mono tabular-nums">{pct(row.net_pct)}</td>
        </tr>
      </tbody>
    </table>
  );
}

function ParetoCard({ rows }: { rows: LossRow[] }) {
  const pts = useMemo(() => paretoPoints(rows.map((r) => ({ eid: r.eid, net: r.net }))), [rows]);
  const data = pts.map((p, i) => ({
    name: `#${i + 1} ${p.eid.slice(0, 18)}`,
    net: p.net,
    cumPct: p.cumShare * 100,
  }));
  return (
    <Card title="Loss-maker Pareto — cumulative share of loss (worst-first, D24)">
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data}>
          <CartesianGrid {...GRID_PROPS} />
          <XAxis dataKey="name" tick={TICK_PROPS} {...AXIS_PROPS} interval={Math.max(0, Math.floor(data.length / 10))} angle={-30} dy={10} height={60} minTickGap={8} />
          <YAxis yAxisId="n" tickFormatter={(v: number) => money(v)} width={70} tick={TICK_PROPS} {...AXIS_PROPS} tickCount={5} />
          <YAxis yAxisId="c" orientation="right" domain={[0, 100]} tickFormatter={(v: number) => `${v.toFixed(0)}%`} tick={TICK_PROPS} {...AXIS_PROPS} tickCount={5} />
          <Tooltip content={<ChartTooltip formatter={(v, name) => (name === 'Cumulative % of loss' ? `${Number(v).toFixed(1)}%` : money(Number(v)))} />} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar yAxisId="n" dataKey="net" name="Net $" fill="#EF4444" />
          <Line yAxisId="c" type="monotone" dataKey="cumPct" name="Cumulative % of loss" stroke="#3B82F6" strokeWidth={2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        Computed client-side from the live /loss-makers net $ values above (worst-first); cumulative % reaches 100% at
        the last bar. No new endpoint (D24).
      </div>
    </Card>
  );
}

const TAG_LABEL: Record<string, string> = {
  high_discount: 'High Discounting',
  excess_returns: 'Excessive Returns',
  logistics_surge: 'Logistics Surge',
  none: 'No tag fired',
};

function DistributionCard({ rows }: { rows: LossRow[] }) {
  const dist = useMemo(() => tagDistribution(rows), [rows]);
  return (
    <Card title="Root-cause distribution — tag counts across these loss-makers (D25)">
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={dist} layout="vertical">
          <CartesianGrid {...GRID_PROPS} />
          <XAxis type="number" allowDecimals={false} tick={TICK_PROPS} {...AXIS_PROPS} tickCount={5} />
          <YAxis type="category" dataKey="key" width={130} tickFormatter={(k: string) => TAG_LABEL[k] ?? k} tick={TICK_PROPS} {...AXIS_PROPS} />
          <Tooltip content={<ChartTooltip formatter={(v) => `${v} entities`} labelFormatter={(k) => TAG_LABEL[String(k)] ?? String(k)} />} />
          <Bar dataKey="count" name="Entities">
            {dist.map((d) => (
              <Cell key={d.key} fill={d.key === 'none' ? '#64748b' : '#f59e0b'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        Counts tag keys from the live rows above (one entity can carry multiple tags, so counts can exceed {rows.length});
        thresholds are quartile-derived per D12. No new endpoint (D25).
      </div>
    </Card>
  );
}
