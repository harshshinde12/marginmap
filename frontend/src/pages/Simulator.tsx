import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
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
import { BAND_ORDER_HELPER } from '../api-helpers';
import { clampShift, rankTornado } from '../addon-helpers';
import { api as backend } from '../api';
import type { ElasticityRow, SimResult } from '../api';
import { Card, ErrorBlock, LoadingBlock, downloadCSV, money, pct } from '../components';

const DIMS = ['product', 'customer', 'segment', 'category', 'region'];

export function Simulator({
  registerExport,
  initial,
}: {
  registerExport: (fn: ExportFn) => void;
  initial: { dimension: string; entityId: string } | null;
}) {
  const [dimension, setDimension] = useState(initial?.dimension ?? 'product');
  const [entityId, setEntityId] = useState(initial?.entityId ?? 'TEC-MA-10000418');
  const [discount, setDiscount] = useState(10);
  const [priceAdj, setPriceAdj] = useState(0);
  const [cogsRed, setCogsRed] = useState(0);
  const [shipCut, setShipCut] = useState(0);
  const [volOverride, setVolOverride] = useState(1.0);
  const appliedKey = useRef<string | null>(null);
  const bands = useQuery({ queryKey: ['elas-cat'], queryFn: () => backend.elasticity('category') });
  const sim = useMutation<SimResult, Error>({
    mutationFn: () =>
      backend.simulate(dimension, entityId.trim(), discount / 100, {
        price_adj: priceAdj / 100,
        cogs_red: cogsRed / 100,
        ship_cut: shipCut / 100,
        vol_override: volOverride,
      }),
  });
  const tech: ElasticityRow[] = bands.data?.rows.filter((r) => r.grp === 'Technology') ?? [];

  // Deep-link from Loss-Maker Alerts: preload the entity and run the real simulator.
  useEffect(() => {
    if (!initial) return;
    const key = `${initial.dimension}|${initial.entityId}`;
    if (appliedKey.current === key) return;
    appliedKey.current = key;
    setDimension(initial.dimension);
    setEntityId(initial.entityId);
  }, [initial]);
  const autoKey = initial ? `${initial.dimension}|${initial.entityId}` : null;
  const lastAutoRun = useRef<string | null>(null);
  useEffect(() => {
    if (autoKey && lastAutoRun.current !== autoKey) {
      lastAutoRun.current = autoKey;
      sim.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoKey]);

  useEffect(() => {
    registerExport(() => {
      const s = sim.data;
      if (!s) return;
      downloadCSV(
        'simulation.csv',
        ['entity_id', 'baseline_sales', 'projected_sales', 'baseline_contribution', 'projected_contribution', 'delta_contribution', 'price_ratio', 'volume_ratio'],
        [[s.entity_id, s.baseline.sales, s.projection.sales, s.baseline.contribution, s.projection.contribution, s.delta.contribution, s.ratios.price, s.ratios.volume]],
      );
    });
  }, [registerExport, sim.data]);

  return (
    <div className="space-y-4">
      {initial && (
        <div className="rounded-xl border border-neon/40 bg-blue-50 p-3 text-sm dark:bg-blue-950">
          Pre-loaded from Loss-Maker Alerts: <strong>{initial.entityId}</strong> ({initial.dimension}). Adjust the
          sliders and re-run — every number below comes from the live /simulate response.
        </div>
      )}
      <Card title="Pricing simulator">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm">
            Dimension
            <select value={dimension} onChange={(e) => setDimension(e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 dark:border-slate-600 dark:bg-slate-900">
              {DIMS.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Entity ID
            <input value={entityId} onChange={(e) => setEntityId(e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 dark:border-slate-600 dark:bg-slate-900" placeholder="e.g. TEC-MA-10000418" />
          </label>
          <Slider label={`Discount Adjustment: ${discount}% (new absolute discount)`} min={0} max={85} step={1} value={discount} onChange={setDiscount} />
          <Slider label={`Price Change: ${priceAdj}% (−90…+200)`} min={-90} max={200} step={1} value={priceAdj} onChange={setPriceAdj} />
          <Slider label={`COGS Reduction: ${cogsRed}% (−10…+90, negative = cost increase)`} min={-10} max={90} step={1} value={cogsRed} onChange={setCogsRed} />
          <Slider label={`Shipping Cut: ${shipCut}% (−10…+90, negative = cost increase)`} min={-10} max={90} step={1} value={shipCut} onChange={setShipCut} />
          <Slider label={`Volume Elasticity Override: ${volOverride.toFixed(2)}x (1.0 = pure band elasticity)`} min={0.1} max={5} step={0.05} value={volOverride} onChange={setVolOverride} />
          <div className="flex flex-wrap items-end gap-2">
            <button onClick={() => setPriceAdj(2)} className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold transition-all duration-175 hover:shadow dark:border-slate-600" title="Set Price Change slider to +2%">
              Conservative +2%
            </button>
            <button onClick={() => setPriceAdj(5)} className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold transition-all duration-175 hover:shadow dark:border-slate-600" title="Set Price Change slider to +5%">
              Aggressive +5%
            </button>
            <button onClick={() => sim.mutate()} className="rounded bg-ink px-4 py-2 text-sm font-semibold text-white transition-all duration-175 hover:shadow dark:bg-neon">
              Run simulation
            </button>
          </div>
        </div>
        {sim.isPending && <LoadingBlock />}
        {sim.error && <ErrorBlock message={String(sim.error)} />}
        {sim.data && <ResultCards sim={sim.data} />}
        {sim.data && (
          <TornadoCard
            dimension={dimension}
            entityId={entityId.trim()}
            discountPct={discount / 100}
            priceAdj={priceAdj / 100}
            cogsRed={cogsRed / 100}
            shipCut={shipCut / 100}
            volOverride={volOverride}
            scenarioContrib={sim.data.projection.contribution}
            historyContrib={sim.data.baseline.contribution}
          />
        )}
      </Card>
      <Card title="Elasticity-lite context — Technology bands (volume flat, contribution collapsing)">
        {bands.isLoading ? (
          <LoadingBlock />
        ) : bands.error || !bands.data ? (
          <ErrorBlock message={String(bands.error)} />
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={BAND_ORDER_HELPER(tech)}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="band" />
              <YAxis yAxisId="qty" tickFormatter={(v: number) => v.toFixed(1)} />
              <YAxis yAxisId="pct" orientation="right" tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`} />
              <Tooltip />
              <Legend />
              <Bar yAxisId="qty" dataKey="avg_qty" name="Avg qty" fill="#3B82F6" />
              <Line yAxisId="pct" type="monotone" dataKey="contribution_pct" name="Contribution %" stroke="#EF4444" strokeWidth={2} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </Card>
    </div>
  );
}

function Slider({ label, min, max, step, value, onChange }: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  return (
    <label className="text-sm">
      {label}
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-1 w-full" />
    </label>
  );
}

function ResultCards({ sim }: { sim: SimResult }) {
  const baseSales = sim.baseline.sales || 1;
  const projSales = sim.projection.sales || 1;
  const basePct = sim.baseline.contribution / baseSales;
  const projPct = sim.projection.contribution / projSales;
  const dPp = (projPct - basePct) * 100;
  const cmp = [
    { name: 'Sales $', baseline: sim.baseline.sales, projected: sim.projection.sales },
    { name: 'Contribution $', baseline: sim.baseline.contribution, projected: sim.projection.contribution },
    { name: 'Unit Volume', baseline: sim.baseline.qty, projected: sim.projection.qty },
  ];
  const cards = [
    {
      label: 'Projected Margin %',
      sub: 'contribution basis — /simulate excludes support/return fees (B1/B6), so true net % is not computable',
      value: pct(projPct),
      delta: `${dPp >= 0 ? '+' : ''}${dPp.toFixed(1)}pp vs baseline`,
      good: dPp >= 0,
    },
    {
      label: 'Incremental Profit',
      sub: 'contribution $ delta, live from /simulate',
      value: `${sim.delta.contribution >= 0 ? '+' : ''}${money(sim.delta.contribution)}`,
      delta: `baseline ${money(sim.baseline.contribution)}`,
      good: sim.delta.contribution >= 0,
    },
    {
      label: 'Volume Impact',
      sub: 'sales $ change from the simulated volume delta',
      value: `${sim.delta.sales >= 0 ? '+' : ''}${money(sim.delta.sales)}`,
      delta: `vol ratio ×${sim.ratios.volume.toFixed(2)}, price ratio ×${sim.ratios.price.toFixed(3)}`,
      good: sim.delta.sales >= 0,
    },
  ];
  return (
    <div className="mt-3 space-y-3">
      <div className="grid gap-3 md:grid-cols-3">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-all duration-175 hover:-translate-y-0.5 hover:shadow-lg dark:border-slate-700 dark:bg-slate-900">
            <div className="font-display text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">{c.label}</div>
            <div className={`mt-1 font-display text-2xl font-bold ${c.good ? 'text-pos' : 'text-neg'}`}>{c.value}</div>
            <div className="mt-1 text-xs font-semibold text-slate-600 dark:text-slate-300">{c.delta}</div>
            <div className="mt-1 text-[11px] text-slate-400 dark:text-[13px]">{c.sub}</div>
          </div>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={cmp} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis type="number" tickFormatter={(v: number) => money(v)} />
          <YAxis type="category" dataKey="name" width={110} />
          <Tooltip formatter={(v) => (typeof v === 'number' ? money(v) : v)} />
          <Legend />
          <Bar dataKey="baseline" name="Baseline" fill="#64748b" />
          <Bar dataKey="projected" name="Simulated" fill="#3B82F6" />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="text-xs text-slate-500 dark:text-[13px] dark:text-slate-400">{sim.assumption_note}</div>
    </div>
  );
}

function TornadoCard({
  dimension,
  entityId,
  discountPct,
  priceAdj,
  cogsRed,
  shipCut,
  volOverride,
  scenarioContrib,
  historyContrib,
}: {
  dimension: string;
  entityId: string;
  discountPct: number;
  priceAdj: number;
  cogsRed: number;
  shipCut: number;
  volOverride: number;
  scenarioContrib: number;
  historyContrib: number;
}) {
  interface TornadoRow {
    lever: string;
    down: number | null;
    up: number | null;
    clampedDown: boolean;
    clampedUp: boolean;
    failed: boolean;
  }
  const [rows, setRows] = useState<TornadoRow[] | null>(null);
  const [failedCount, setFailedCount] = useState(0);
  const key = `${dimension}|${entityId}|${discountPct}|${priceAdj}|${cogsRed}|${shipCut}|${volOverride}|${scenarioContrib}`;
  useEffect(() => {
    let live = true;
    setRows(null);
    setFailedCount(0);
    const defs = [
      { lever: 'Price ±1pp', field: 'price_adj', cur: priceAdj, reqDown: priceAdj - 0.01, reqUp: priceAdj + 0.01, lo: -0.9, hi: 2.0 },
      { lever: 'COGS ±1pp', field: 'cogs_red', cur: cogsRed, reqDown: cogsRed - 0.01, reqUp: cogsRed + 0.01, lo: -0.1, hi: 0.9 },
      { lever: 'Shipping ±1pp', field: 'ship_cut', cur: shipCut, reqDown: shipCut - 0.01, reqUp: shipCut + 0.01, lo: -0.1, hi: 0.9 },
      { lever: 'Volume ±1%', field: 'vol_override', cur: volOverride, reqDown: volOverride * 0.99, reqUp: volOverride * 1.01, lo: 0.1, hi: 5.0 },
    ];
    const base = { price_adj: priceAdj, cogs_red: cogsRed, ship_cut: shipCut, vol_override: volOverride };
    // 8 /simulate calls in parallel; each settles independently so one failure
    // never crashes the card — failed sides render as missing with a note.
    const tasks = defs.flatMap((d) => {
      const dn = clampShift(d.reqDown, d.lo, d.hi);
      const up = clampShift(d.reqUp, d.lo, d.hi);
      const call = (side: 'down' | 'up', value: number) =>
        backend
          .simulate(dimension, entityId, discountPct, { ...base, [d.field]: value })
          .then((r) => ({ lever: d.lever, side, ok: true as const, contrib: r.projection.contribution }))
          .catch((e) => ({ lever: d.lever, side, ok: false as const, error: String(e) }));
      return [
        { def: d, side: 'down' as const, clamped: dn.clamped, task: call('down', dn.value) },
        { def: d, side: 'up' as const, clamped: up.clamped, task: call('up', up.value) },
      ];
    });
    Promise.all(tasks.map((t) => t.task)).then((settled) => {
      if (!live) return;
      const byLever = new Map<string, TornadoRow>();
      for (const d of defs) byLever.set(d.lever, { lever: d.lever, down: null, up: null, clampedDown: false, clampedUp: false, failed: false });
      let failed = 0;
      settled.forEach((s, i) => {
        const meta = tasks[i];
        const row = byLever.get(s.lever)!;
        if (meta.side === 'down') row.clampedDown = meta.clamped;
        else row.clampedUp = meta.clamped;
        if (s.ok) {
          const delta = s.contrib - scenarioContrib;
          if (meta.side === 'down') row.down = delta;
          else row.up = delta;
        } else {
          row.failed = true;
          failed += 1;
        }
      });
      const list = [...byLever.values()];
      const ranked = rankTornado(
        list.map((r) => ({ lever: r.lever, downDelta: r.down ?? 0, upDelta: r.up ?? 0 })),
      );
      const order = new Map(ranked.map((r, idx) => [r.lever, idx]));
      list.sort((a, b) => (order.get(a.lever) ?? 0) - (order.get(b.lever) ?? 0));
      // Append a visible clamped marker on the affected bar label.
      for (const r of list) {
        const bits: string[] = [];
        if (r.clampedDown) bits.push('down clamped');
        if (r.clampedUp) bits.push('up clamped');
        if (bits.length > 0) r.lever = `${r.lever} ⚠ ${bits.join(' + ')}`;
      }
      setRows(list);
      setFailedCount(failed);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/50 p-3 dark:border-slate-700 dark:bg-slate-900">
      <h4 className="text-sm font-semibold">
        Sensitivity tornado — deltas vs current slider scenario ({money(scenarioContrib)}) (live /simulate, D22/D26)
      </h4>
      {!rows ? (
        <LoadingBlock />
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={rows} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" tickFormatter={(v: number) => money(v)} />
            <YAxis type="category" dataKey="lever" width={150} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v) => (v === null || v === undefined ? 'failed / n/a' : money(Number(v)))} />
            <ReferenceLine x={0} stroke="#0f172a" />
            <Legend />
            <Bar dataKey="down" name="Down shift" fill="#EF4444" />
            <Bar dataKey="up" name="Up shift" fill="#10B981">
              {rows.map((r) => (
                <Cell key={r.lever} fill="#10B981" />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
      <div className="mt-1 text-xs text-slate-500 dark:text-[13px] dark:text-slate-400">
        Baseline: current slider scenario projection ({money(scenarioContrib)} contribution) — not the historical
        baseline ({money(historyContrib)}). Each lever shifted independently while the other sliders stay at their
        current values; ranked by absolute contribution delta.
        {rows && rows.some((r) => r.clampedDown || r.clampedUp)
          ? ' ⚠ clamped = requested shift hit a backend bound and was limited to it.'
          : ''}
        {failedCount > 0 ? ` ${failedCount} shift(s) failed to load and show as missing (card kept the rest).` : ''}
      </div>
    </div>
  );
}
