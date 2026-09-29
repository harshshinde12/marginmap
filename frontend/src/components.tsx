import type { ReactNode } from 'react';

/* ------------------------------------------------------------------ */
/* Design-system primitives (see DESIGN_SYSTEM.md — values live here). */
/* Type scale: 12 / 13 / 14 / 16 / 20 / 28 / 36 / 40px.                */
/* Spacing: 8px grid — p-4/p-5, gap-3/gap-4. Radius: xl cards, lg      */
/* inputs/badges, full pills only. Elevation: 1px border + subtle     */
/* shadow resting; neon/30 border + soft glow on hover.                */
/* ------------------------------------------------------------------ */

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`skeleton-pulse ${className}`} />;
}

/** Generic loader — matches the surrounding card so layout never shifts. */
export function LoadingBlock() {
  return (
    <div className="space-y-3 p-1" role="status" aria-label="Loading">
      <Skeleton className="h-3 w-1/3" />
      <Skeleton className="h-[220px] w-full" />
    </div>
  );
}

/** KPI banner placeholder: 4 cards, same grid as the real banner. */
export function KpiSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" role="status" aria-label="Loading">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="rounded-xl border border-black/5 bg-white p-5 shadow-card dark:border-white/5 dark:bg-navyCard">
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="mt-2 h-9 w-3/4" />
          <div className="mt-2 flex items-center justify-between gap-2">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-8 w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Chart placeholder: title-width bar + fixed-height plot area. */
export function ChartSkeleton({ height = 260 }: { height?: number }) {
  return (
    <div className="space-y-2" role="status" aria-label="Loading chart">
      <Skeleton className="h-3 w-1/4" />
      <div aria-hidden style={{ height }} className="skeleton-pulse w-full" />
    </div>
  );
}

/** Table placeholder: header row + N body rows at text density. */
export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-1.5" role="status" aria-label="Loading table">
      <Skeleton className="h-3 w-full opacity-70" />
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-5 w-full" />
      ))}
    </div>
  );
}

export function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
      Failed to load data: {message}. Is the backend running?
    </div>
  );
}

export function EmptyBlock({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-black/5 bg-white p-8 text-center dark:border-white/5 dark:bg-navyCard">
      <svg className="mb-3 h-8 w-8 text-slate-300 dark:text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
      </svg>
      <div className="text-sm font-medium text-slate-500 dark:text-slate-400">{message}</div>
    </div>
  );
}

/* Recharts default-style override (kept for any built-in tooltip usage). */
export const TOOLTIP_STYLE = {
  contentStyle: {
    background: 'var(--tooltip-bg, #FFFFFF)',
    border: '1px solid rgba(148,163,184,0.25)',
    borderRadius: '12px',
    fontSize: '12px',
    fontFamily: 'Inter, system-ui, sans-serif',
    padding: '8px 12px',
    boxShadow: '0 0 0 1px rgba(59,130,246,0.1), 0 8px 24px -8px rgba(0,0,0,0.3)',
    color: '#0F172A',
  },
  itemStyle: { color: '#475569', fontSize: '12px', fontFamily: '"IBM Plex Mono", ui-monospace, monospace' },
  labelStyle: { color: '#0F172A', fontWeight: 600, marginBottom: '4px', fontSize: '12px' },
  cursor: { fill: 'rgba(148,163,184,0.12)' },
};

/* ---------------- Chart conventions (one source of truth) ---------------- */

/** Thin, low-opacity dashed grid — never solid. Spread onto every CartesianGrid. */
export const GRID_PROPS = {
  stroke: '#94A3B8',
  strokeOpacity: 0.12,
  strokeDasharray: '3 3',
} as const;

/** Small caption ticks, no axis/tick lines (Linear-style). */
export const TICK_PROPS = { fontSize: 12, fill: '#64748B' } as const;
export const AXIS_PROPS = { tickLine: false, axisLine: false } as const;

/** Zero-line / average reference: dashed slate, never solid ink. */
export const REF_LINE_PROPS = {
  stroke: '#64748B',
  strokeDasharray: '4 4',
  strokeOpacity: 0.55,
} as const;

/**
 * Single reusable chart tooltip — same border/shadow/radius as Card.
 * Every Recharts chart must use this (via `content={<ChartTooltip …/>}`),
 * passing a formatter that renders the exact API number (money/pct).
 */
export function ChartTooltip({
  active,
  payload,
  label,
  formatter,
  labelFormatter,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number | string; color?: string; dataKey?: string | number; payload?: Record<string, unknown> }[];
  label?: string | number;
  formatter?: (value: number | string, name: string) => string;
  labelFormatter?: (label: string) => string;
}) {
  if (!active || !payload?.length) return null;
  const title = label !== undefined && label !== '' ? String(label) : (payload[0]?.name ?? '');
  return (
    <div className="min-w-[160px] max-w-[280px] rounded-xl border border-black/5 bg-white px-3 py-2 text-xs shadow-card-hover dark:border-white/10 dark:bg-navyCard dark:shadow-card-hover-dark">
      <div className="mb-1 truncate font-display text-xs font-semibold text-ink dark:text-white">
        {labelFormatter && label !== undefined ? labelFormatter(String(label)) : title}
      </div>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center justify-between gap-4 py-px">
          <span className="inline-flex min-w-0 items-center gap-1.5 text-slate-500 dark:text-slate-400">
            {p.color && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.color }} />}
            <span className="truncate">{p.name}</span>
          </span>
          <span className="shrink-0 font-mono font-semibold tabular-nums text-ink dark:text-slate-100">
            {formatter ? formatter(p.value ?? '', String(p.name ?? p.dataKey ?? '')) : String(p.value ?? '')}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ---------- Margin step scale: 7 fixed steps, red → neutral → emerald ---------- */
/* Cells quantize |net %| into these bands instead of auto-interpolating.        */

const STEP_ALPHAS = [0.1, 0.18, 0.3, 0.42, 0.56, 0.7, 0.85];
const STEP_EDGES = [0.02, 0.05, 0.1, 0.15, 0.2, 0.3];

function stepLevel(v: number): number {
  const a = Math.abs(v);
  for (let i = 0; i < STEP_EDGES.length; i++) {
    if (a < STEP_EDGES[i]) return i;
  }
  return STEP_EDGES.length;
}

/** Stepped translucent cell background. Emerald ≥ 0, red < 0 (D1), slate ≈ 0. */
export function marginCellBg(v: number | undefined): string | undefined {
  if (v === undefined || Number.isNaN(v)) return undefined;
  const lvl = stepLevel(v);
  const alpha = STEP_ALPHAS[lvl];
  if (Math.abs(v) < STEP_EDGES[0]) return `rgba(100,116,139,${alpha})`;
  return v >= 0 ? `rgba(16,185,129,${alpha})` : `rgba(239,68,68,${alpha})`;
}

/** Solid step color for dots / map fills at full opacity steps. */
export function marginStepColor(v: number): string {
  const a = Math.abs(v);
  if (a < 0.02) return '#64748B';
  if (v >= 0) {
    if (a < 0.05) return '#6EE7B7';
    if (a < 0.15) return '#10B981';
    return '#065F46';
  }
  if (a < 0.05) return '#FCA5A5';
  if (a < 0.15) return '#EF4444';
  return '#991B1B';
}

export const MARGIN_SCALE_LEGEND = [
  { label: '≤ −30%', color: '#991B1B' },
  { label: '−15%', color: '#EF4444' },
  { label: '−5%', color: '#FCA5A5' },
  { label: '≈ 0', color: '#64748B' },
  { label: '+5%', color: '#6EE7B7' },
  { label: '+15%', color: '#10B981' },
  { label: '≥ +30%', color: '#065F46' },
] as const;

/* ---- Desaturated cost palette: neutrals for buckets, amber only for ---- */
/* ---- Support/attention. Neon blue is reserved for active states. -------- */
export const COST_COLORS = {
  cogs: '#475569',
  freight: '#64748B',
  freightHi: '#334155',
  freightLo: '#94A3B8',
  support: '#F59E0B',
  returns: '#94A3B8',
  revenue: '#334155',
  baseline: '#64748B',
  simulated: '#3B82F6',
} as const;

/* ---- Form controls: one height/padding/focus-ring for every select. ---- */
export const SELECT_CLASS =
  'h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 shadow-sm transition-all duration-175 focus:outline-none focus:ring-2 focus:ring-neon/40 dark:border-slate-700 dark:bg-navyCard dark:text-slate-200';

/* ---- Sub-tab pills: neutral active (ink) / neon in dark, never white block. ---- */
export const SUBTAB_ACTIVE =
  'bg-ink text-white shadow dark:bg-neon dark:text-white';
export const SUBTAB_INACTIVE =
  'text-slate-500 hover:text-ink dark:text-slate-400 dark:hover:text-white';

const HOVER =
  'transition-all duration-175 hover:shadow-card-hover hover:border-neon/30 dark:hover:shadow-card-hover-dark dark:hover:border-neon/30';

export function Card({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div
      className={`rounded-xl border border-black/5 bg-white p-4 shadow-card dark:border-white/5 dark:bg-navyCard dark:shadow-card-dark ${HOVER}`}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-display text-xs font-semibold uppercase tracking-widest text-slate-500 opacity-60 dark:text-slate-300">
          {title}
        </h3>
        {action}
      </div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

export function MetricBox({ children, className = '' }: { children: ReactNode, className?: string }) {
  return (
    <div
      className={`rounded-xl border border-black/5 bg-white shadow-card dark:border-white/5 dark:bg-navyCard dark:shadow-card-dark ${HOVER} ${className || 'p-4'}`}
    >
      {children}
    </div>
  );
}

/** Tiny sparkline: 1.5px line, gradient fill at 0.08, dot only on hover. */
export function Sparkline({ values, width = 120, height = 32 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return <span className="text-xs text-slate-400">n/a</span>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const pts = values
    .map((v, i) => `${(i * step).toFixed(1)},${(height - 3 - ((v - min) / span) * (height - 6)).toFixed(1)}`)
    .join(' ');
  const up = values[values.length - 1] >= values[0];
  const color = up ? '#10B981' : '#EF4444';
  const lastX = width.toFixed(1);
  const lastY = (height - 3 - ((values[values.length - 1] - min) / span) * (height - 6)).toFixed(1);
  const gradId = `spark-grad-${Math.random().toString(36).substring(2, 9)}`;
  const fillPts = `0,${height} ${pts} ${width},${height}`;
  return (
    <span className="group inline-flex">
      <svg width={width} height={height} className="overflow-visible">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.08} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <polygon points={fillPts} fill={`url(#${gradId})`} />
        <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={lastX} cy={lastY} r={2.5} fill={color} strokeWidth={0} opacity={0} className="transition-opacity duration-175 group-hover:opacity-100" />
      </svg>
    </span>
  );
}

/** Uniform badge classes (light values per spec; dark complements preserve the dark theme). */
export const BADGE_POS = 'inline-flex items-center rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/50 dark:text-emerald-400';
export const BADGE_WARN = 'inline-flex items-center rounded-lg border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:border-amber-800/60 dark:bg-amber-950/50 dark:text-amber-400';
export const BADGE_NEG = 'inline-flex items-center rounded-lg border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700 dark:border-rose-800/60 dark:bg-rose-950/50 dark:text-rose-400';

/** Period-over-period delta pill. Emerald = positive, red = negative (both themes). */
export function DeltaBadge({ delta, suffix = '', invert = false }: { delta: number; suffix?: string; invert?: boolean }) {
  const good = invert ? delta < 0 : delta >= 0;
  const sign = delta >= 0 ? '+' : '';
  return (
    <span className={good ? BADGE_POS : BADGE_NEG}>
      {sign}
      {delta.toLocaleString('en-US', { maximumFractionDigits: 0 })}
      {suffix}
    </span>
  );
}

export interface CostDatum {
  sales?: number;
  revenue?: number;
  cogs?: number;
  shipping?: number;
  support?: number;
  return_cost?: number;
  net?: number;
  gross?: number;
  gross_pct?: number;
  net_pct?: number;
}

/** Rich hover popover: every cost field pulled live from the datum (D5). */
export function RichTooltip({ datum, label }: { datum: CostDatum; label?: string }) {
  const rev = datum.sales ?? datum.revenue ?? 0;
  const rows: [string, string][] = [
    ['Revenue', money(rev)],
    ['COGS', money(datum.cogs ?? 0)],
    ['Shipping', money(datum.shipping ?? 0)],
    ['Support', money(datum.support ?? 0)],
    ['Return Cost', money(datum.return_cost ?? 0)],
    ['Net $', money(datum.net ?? 0)],
    ['Net %', pct(datum.net_pct ?? 0)],
  ];
  if (datum.gross !== undefined) rows.splice(1, 0, ['Gross', money(datum.gross)]);
  return (
    <div className="min-w-[180px] rounded-xl border border-black/5 bg-white px-3 py-2 text-xs shadow-card-hover dark:border-white/10 dark:bg-navyCard dark:shadow-card-hover-dark dark:text-slate-100">
      {label && <div className="mb-1 truncate font-display font-semibold text-ink dark:text-white">{label}</div>}
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-4 py-px">
          <span className="text-slate-500 dark:text-slate-400">{k}</span>
          <span className="font-mono font-semibold tabular-nums">{v}</span>
        </div>
      ))}
    </div>
  );
}

export function money(v: number): string {
  const sign = v < 0 ? '-' : '';
  return `${sign}$${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

export function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

/** Inline horizontal Margin % bar for table cells (emerald/red fixed, D1). */
export function MarginBar({ value, maxAbs }: { value: number; maxAbs: number }) {
  const w = Math.min(100, (Math.abs(value) / Math.max(maxAbs, 1e-9)) * 100);
  const neg = value < 0;
  return (
    <span className="flex items-center gap-2">
      <span className="h-2 min-w-8 flex-1 overflow-hidden rounded bg-slate-100 dark:bg-slate-700/60">
        <span
          className="block h-full rounded"
          style={{ width: `${w}%`, background: neg ? '#EF4444' : '#10B981', marginLeft: neg ? 'auto' : undefined }}
        />
      </span>
      <span className="w-14 shrink-0 text-right font-mono text-xs tabular-nums">{pct(value)}</span>
    </span>
  );
}

/** Download rows as a real CSV file (Blob). No email anywhere (D4). */
export function downloadCSV(filename: string, columns: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = [columns.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Print-to-PDF via the browser (D4). */
export function printPDF() {
  window.print();
}

export function Drawer({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div
        className="h-full w-full max-w-xl overflow-y-auto border-l border-black/5 bg-white p-5 shadow-2xl dark:border-white/10 dark:bg-navyCard dark:text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold tracking-tight">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px] font-medium transition-all duration-175 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
