import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ExportFn } from '../App';
import type { DrillDim } from '../App';
import { ProfitRow, api } from '../api';
import { formatCurrency, formatPct } from '../format';
import { Card, EmptyBlock, ErrorBlock, ChartSkeleton, TableSkeleton, MarginBar, RichTooltip, AXIS_PROPS, GRID_PROPS, SELECT_CLASS, SUBTAB_ACTIVE, SUBTAB_INACTIVE, TICK_PROPS, COST_COLORS, downloadCSV, marginCellBg, money, pct } from '../components';
import { Choropleth } from '../Choropleth';
import geo from '../assets/us-states.json';
import { filterUsStates, leaderboards } from '../addon-helpers';

const TABS: { key: DrillDim; label: string }[] = [
  { key: 'product', label: 'Product' },
  { key: 'customer', label: 'Customer' },
  { key: 'segment', label: 'Channel' },
  { key: 'region', label: 'Region' },
];

type TabKey = DrillDim;
type SortKey = 'net' | 'sales' | 'gross_pct' | 'net_pct' | 'returns';
type ViewMode = 'list' | 'grid';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'net', label: 'Net $ (worst first)' },
  { key: 'sales', label: 'Revenue (top first)' },
  { key: 'gross_pct', label: 'Gross % (worst first)' },
  { key: 'net_pct', label: 'Net % (worst first)' },
  { key: 'returns', label: 'Return lines (most first)' },
];

export function DrillDown({
  registerExport,
  dim: tab,
  onDimChange: setTab,
}: {
  registerExport: (fn: ExportFn) => void;
  dim: TabKey;
  onDimChange: (d: TabKey) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('net');
  const [view, setView] = useState<ViewMode>('list');
  const [heatRows, setHeatRows] = useState('category');
  const [heatCols, setHeatCols] = useState('segment');
  const [heatPage, setHeatPage] = useState(0);
  const { data, isLoading, error } = useQuery({
    queryKey: ['prof', tab],
    queryFn: () => api.profitability(tab, tab === 'product' ? 60 : undefined),
  });
  const heat = useQuery({
    queryKey: ['heatmap', heatRows, heatCols, heatPage],
    queryFn: () => api.heatmap(heatRows, heatCols, 50, heatPage * 50),
  });

  const rows = useMemo(() => {
    const rs = [...(data?.rows ?? [])];
    switch (sortKey) {
      case 'net':
        return rs.sort((a, b) => a.net - b.net);
      case 'sales':
        return rs.sort((a, b) => b.sales - a.sales);
      case 'gross_pct':
        return rs.sort((a, b) => a.gross_pct - b.gross_pct);
      case 'net_pct':
        return rs.sort((a, b) => a.net_pct - b.net_pct);
      case 'returns':
        return rs.sort((a, b) => b.n_returned_lines - a.n_returned_lines);
    }
  }, [data, sortKey]);
  const maxAbsPct = useMemo(
    () => Math.max(0.01, ...(rows.slice(0, 60).map((r) => Math.abs(r.net_pct ?? 0)) ?? [])),
    [rows],
  );

  useEffect(() => {
    registerExport(() => {
      const rs = rows.map((r) => [r.label, r.sales, r.cogs, r.shipping, r.support, r.return_cost, r.net, r.net_pct]);
      downloadCSV(`drilldown-${tab}.csv`, ['name', 'revenue', 'cogs', 'shipping', 'support', 'return_cost', 'net', 'net_pct'], rs);
    });
  }, [registerExport, rows, tab]);

  return (
    <div className="flex flex-col gap-4">
      <div className="relative z-20 border-b border-black/5 bg-white py-2 dark:border-white/5 dark:bg-navy">
      <div className="no-print inline-flex flex-wrap items-center gap-1 rounded-xl border border-black/5 bg-slate-100 p-1 dark:border-white/5 dark:bg-slate-900">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition-all duration-175 ${
              tab === t.key ? SUBTAB_ACTIVE : SUBTAB_INACTIVE
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="no-print flex flex-wrap items-center gap-2">
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className={SELECT_CLASS}
          title="Client-side sort, no new endpoint"
        >
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              Sort: {s.label}
            </option>
          ))}
        </select>
        <button
          onClick={() => setView(view === 'list' ? 'grid' : 'list')}
          className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 shadow-sm transition-all duration-175 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-neon/40 dark:border-slate-700 dark:bg-navyCard dark:text-slate-200 dark:hover:bg-navyCardHover"
          title="Client-side view toggle"
        >
          View: {view === 'list' ? 'List' : 'Grid'}
        </button>
      </div>
      </div>

      {isLoading ? (
        <Card title="Loading profitability…">
          <TableSkeleton rows={8} />
        </Card>
      ) : error || !data ? (
        <ErrorBlock message={String(error)} />
      ) : rows.length === 0 ? (
        <EmptyBlock message="No rows for this dimension." />
      ) : tab === 'region' ? (
        <RegionView />
      ) : view === 'list' ? (
        <Card title={`${TABS.find((t) => t.key === tab)?.label} profitability (showing ${rows.length})`}>
          <div className="max-h-[600px] overflow-y-auto overflow-x-hidden">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white dark:bg-navyCard">
                <tr className="text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3 text-right">Revenue</th>
                  <th className="py-2 pr-3 text-right">Net</th>
                  <th className="py-2 pr-3 text-right">Net %</th>
                  <th className="py-2 pr-3" style={{ width: '22%' }}>Margin %</th>
                  <th className="py-2 pr-3 text-right">Returns</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 60).map((r) => (
                  <RowWithDetail key={r.grp} row={r} maxAbs={maxAbsPct} expanded={expanded === r.grp} onToggle={() => setExpanded(expanded === r.grp ? null : r.grp)} />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <div className="max-h-[600px] overflow-y-auto overflow-x-hidden">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {rows.slice(0, 30).map((r) => (
            <button
              key={r.grp}
              onClick={() => setExpanded(expanded === r.grp ? null : r.grp)}
              className="rounded-xl border border-black/5 bg-white p-3 text-left shadow-card transition-all duration-175 hover:border-neon/30 hover:shadow-card-hover dark:border-white/5 dark:bg-navyCard dark:hover:border-neon/30"
            >
              <div className="truncate text-sm font-medium">{r.label}</div>
              <div className={`font-mono text-lg font-bold tabular-nums ${r.net < 0 ? 'text-neg' : 'text-pos'}`}>{money(r.net)}</div>
              <div className="font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
                {money(r.sales)} · {pct(r.net_pct)} · {r.n_returned_lines} returns
              </div>
              {expanded === r.grp && <CostBreakdown row={r} />}
            </button>
          ))}
          </div>
        </div>
      )}

      <Card
        title="Margin heatmap (net % cells, reconciled to summary)"
        action={
          <div className="flex gap-1 text-xs">
            <select value={heatRows} onChange={(e) => { setHeatRows(e.target.value); setHeatPage(0); }} className={SELECT_CLASS} style={{ height: 32 }}>
              <option value="category">rows: category</option>
              <option value="product">rows: product</option>
            </select>
            <select value={heatCols} onChange={(e) => setHeatCols(e.target.value)} className={SELECT_CLASS} style={{ height: 32 }}>
              <option value="segment">cols: segment</option>
              <option value="region">cols: region</option>
            </select>
          </div>
        }
      >
        {heat.isLoading ? (
          <ChartSkeleton height={220} />
        ) : heat.error || !heat.data ? (
          <ErrorBlock message={String(heat.error)} />
        ) : (
          <HeatTable
            heat={heat.data}
            page={heatPage}
            setPage={setHeatPage}
          />
        )}
      </Card>
    </div>
  );
}

function RowWithDetail({ row: r, maxAbs, expanded, onToggle }: { row: ProfitRow; maxAbs: number; expanded: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="row-hover cursor-pointer border-t border-slate-100 dark:border-slate-700" onClick={onToggle}>
        <td className="py-2 pr-3 font-medium">{r.label}</td>
        <td className="py-2 pr-3 text-right font-mono tabular-nums">{formatCurrency(r.sales)}</td>
        <td className={`py-2 pr-3 text-right font-mono tabular-nums ${r.net < 0 ? 'text-neg' : 'text-pos'}`}>{formatCurrency(r.net)}</td>
        <td className={`py-2 pr-3 text-right font-mono tabular-nums ${r.net_pct < 0 ? 'text-neg' : 'text-pos'}`}>{formatPct(r.net_pct)}</td>
        <td className="py-2 pr-3">
          <MarginBar value={r.net_pct} maxAbs={maxAbs} />
        </td>
        <td className="py-2 pr-3 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400">{r.n_returned_lines}</td>
      </tr>
      {expanded && (
        <tr className="border-t border-slate-100 bg-slate-50/60 dark:border-slate-700 dark:bg-navyCardHover">
          <td colSpan={6} className="p-3">
            <CostBreakdown row={r} />
          </td>
        </tr>
      )}
    </>
  );
}

function CostBreakdown({ row }: { row: ProfitRow }) {
  const data = [
    { name: 'COGS', value: row.cogs },
    { name: 'Freight', value: row.shipping },
    { name: 'Support', value: row.support },
    { name: 'Returns', value: row.return_cost },
    { name: 'Net', value: row.net },
  ];
  return (
    <div>
      <div className="text-xs text-slate-500 dark:text-slate-400">
        Cost breakdown for {row.label} — revenue {formatCurrency(row.sales)}, gross {formatCurrency(row.gross)} (
        {formatPct(row.gross_pct)})
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data}>
          <CartesianGrid {...GRID_PROPS} />
          <XAxis dataKey="name" tick={TICK_PROPS} {...AXIS_PROPS} />
          <YAxis tickFormatter={(v: number) => formatCurrency(v)} tick={TICK_PROPS} {...AXIS_PROPS} tickCount={5} />
          <Tooltip content={<RowTip row={row} />} />
          <Bar dataKey="value" fill={COST_COLORS.revenue} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function RowTip(props: { active?: boolean; payload?: { payload: { name: string; value: number } }[]; row?: ProfitRow }) {
  if (!props.active || !props.payload?.length || !props.row) return null;
  const hovered = props.payload[0].payload;
  return <RichTooltip datum={props.row} label={`${props.row.label} — ${hovered.name}: ${formatCurrency(hovered.value)}`} />;
}

function RegionView() {
  // Limit must cover all 1,094 global states: the endpoint sorts by net DESC,
  // so the worst loss-makers (incl. 14 net-negative US states) live past offset 200.
  const states = useQuery({ queryKey: ['prof-state'], queryFn: () => api.profitability('state', 2000) });
  const markets = useQuery({ queryKey: ['prof-market'], queryFn: () => api.profitability('market') });
  if (states.isLoading || markets.isLoading)
    return (
      <Card title="Loading regions…">
        <ChartSkeleton height={220} />
      </Card>
    );
  if (states.error || markets.error || !states.data || !markets.data)
    return <ErrorBlock message={String(states.error ?? markets.error)} />;
  const vals = new Map(states.data.rows.map((r) => [r.grp, { net: r.net, net_pct: r.net_pct, revenue: r.sales }]));
  // US-only leaderboards: same name set as the choropleth boundaries (D23).
  // /profitability?group_by=state merges duplicate non-US names across countries;
  // US names are unique in the data, so name filtering is exact.
  const usNames = new Set(
    (geo as { features: { properties: { name: string } }[] }).features.map((f) => f.properties.name),
  );
  const usRows = filterUsStates(states.data.rows, usNames);
  const { top5, bottom5 } = leaderboards(usRows);
  return (
    <div className="space-y-4">
      <Card title="US states — net margin choropleth (real state-name join)">
        <Choropleth values={vals} />
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Top-5 US states by net $ (all-time)">
          <LeaderTable rows={top5} />
        </Card>
        <Card title="Bottom-5 US states by net $ (all-time)">
          <LeaderTable rows={bottom5} />
        </Card>
      </div>
      <div className="text-xs text-slate-500 dark:text-slate-400">
        Leaderboards are US-only: the live /profitability?group_by=state response filtered to the
        {` ${usNames.size} `} choropleth boundary names ({usRows.length} matched), then Top/Bottom-5 by net $ (D23).
      </div>
      <Card title="Non-US markets stay in bar/table view (never on the map)">
        <div className="max-h-[480px] overflow-y-auto overflow-x-hidden">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={markets.data.rows} layout="vertical">
              <CartesianGrid {...GRID_PROPS} />
              <XAxis type="number" tickFormatter={(v: number) => money(v)} tick={TICK_PROPS} {...AXIS_PROPS} tickCount={5} />
              <YAxis type="category" dataKey="label" width={130} tick={TICK_PROPS} {...AXIS_PROPS} />
              <Tooltip content={<MarketTip />} />
              <Bar dataKey="net" name="Net $">
                {markets.data.rows.map((r) => (
                  <Cell key={r.grp} fill={r.net >= 0 ? '#10B981' : '#EF4444'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}

function MarketTip(props: { active?: boolean; payload?: { payload: ProfitRow }[] }) {
  if (!props.active || !props.payload?.length) return null;
  const d = props.payload[0].payload;
  return <RichTooltip datum={d} label={d.label} />;
}

function LeaderTable({ rows }: { rows: ProfitRow[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          <th className="py-1 pr-2">State</th>
          <th className="py-1 pr-2 text-right">Net $</th>
          <th className="py-1 text-right">Net %</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.grp} className="row-hover border-t border-slate-100 dark:border-slate-700">
            <td className="max-w-[160px] truncate py-1.5 pr-2 font-medium" title={`${r.label} — revenue ${formatCurrency(r.sales)}, ${r.n_lines} lines`}>
              {r.label}
            </td>
            <td className={`py-1.5 pr-2 text-right font-mono font-semibold tabular-nums ${r.net < 0 ? 'text-neg' : 'text-pos'}`}>{money(r.net)}</td>
            <td className={`py-1.5 text-right font-mono tabular-nums ${r.net_pct < 0 ? 'text-neg' : 'text-pos'}`}>{pct(r.net_pct)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function HeatTable({
  heat,
  page,
  setPage,
}: {
  heat: {
    row_totals: { row: string; row_label: string; net: number; revenue: number; n_lines: number; net_pct: number }[];
    n_rows_total: number;
    cells: { row: string; row_label: string; col: string; revenue: number; net: number; net_pct: number }[];
    total_net_cells: number;
    summary_net: number;
    reconciles: boolean;
  };
  page: number;
  setPage: (p: number) => void;
}) {
  const cols = [...new Set(heat.cells.map((c) => c.col))].sort();
  const cell = (r: string, c: string) => heat.cells.find((x) => x.row === r && x.col === c);
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <th className="p-1 text-left">Row</th>
              {cols.map((c) => (
                <th key={c} className="p-1 text-right">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {heat.row_totals.map((t) => (
              <tr key={t.row} className="border-t border-slate-100 dark:border-slate-700">
                <td className="max-w-[180px] truncate p-1 font-medium" title={t.row_label}>
                  {t.row_label} <span className="font-mono tabular-nums text-slate-400">({money(t.net)})</span>
                </td>
                {cols.map((c) => {
                  const v = cell(t.row, c);
                  return (
                    <td key={c} className="p-1 text-right font-mono tabular-nums" style={{ background: marginCellBg(v?.net_pct) }} title={v ? `net ${money(v.net)} (${pct(v.net_pct)}) on ${money(v.revenue)}` : 'no lines'}>
                      {v ? pct(v.net_pct) : '—'}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
        <span>
          Σ cells {money(heat.total_net_cells)} vs summary {money(heat.summary_net)} —{' '}
          {heat.reconciles ? 'reconciles ✓' : 'MISMATCH'}
        </span>
        {heat.n_rows_total > heat.row_totals.length || page > 0 ? (
          <span className="flex gap-1">
            <button disabled={page === 0} onClick={() => setPage(page - 1)} className="rounded-lg border border-slate-200 px-2 py-0.5 disabled:opacity-40 dark:border-slate-700">← prev 50</button>
            <span className="px-1">worst-first, page {page + 1}</span>
            <button
              disabled={(page + 1) * 50 >= heat.n_rows_total}
              onClick={() => setPage(page + 1)}
              className="rounded-lg border border-slate-200 px-2 py-0.5 disabled:opacity-40 dark:border-slate-700"
            >
              next 50 →
            </button>
          </span>
        ) : (
          <span>all rows shown</span>
        )}
      </div>
    </div>
  );
}
