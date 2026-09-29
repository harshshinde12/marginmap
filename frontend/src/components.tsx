import type { ReactNode } from 'react';

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-slate-200 dark:bg-slate-700 ${className}`} />;
}

export function LoadingBlock() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-8 w-1/3" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

export function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="rounded border border-red-300 bg-red-50 p-4 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
      Failed to load data: {message}. Is the backend running?
    </div>
  );
}

export function EmptyBlock({ message }: { message: string }) {
  return (
    <div className="rounded border border-slate-200 bg-white p-6 text-center text-slate-500 dark:border-slate-700 dark:bg-navyCard dark:text-slate-400">
      {message}
    </div>
  );
}

const HOVER =
  'transition-all duration-175 hover:-translate-y-0.5 hover:shadow-lg hover:border-neon/60 dark:hover:border-neon/60';

export function Card({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-navyCard dark:shadow-black/30 ${HOVER}`}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">
          {title}
        </h3>
        {action}
      </div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

export function MetricBox({ children }: { children: ReactNode }) {
  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-navyCard ${HOVER}`}
    >
      {children}
    </div>
  );
}

/** Tiny sparkline (no axes) from a list of numbers. Color follows sign of last-vs-first. */
export function Sparkline({ values, width = 120, height = 32 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return <span className="text-xs text-slate-400 dark:text-[13px]">n/a</span>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const pts = values
    .map((v, i) => `${(i * step).toFixed(1)},${(height - 3 - ((v - min) / span) * (height - 6)).toFixed(1)}`)
    .join(' ');
  const up = values[values.length - 1] >= values[0];
  const color = up ? '#10B981' : '#EF4444';
  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
    </svg>
  );
}

/** Uniform badge classes (light values per spec; dark complements preserve the dark theme). */
export const BADGE_POS =
  'border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300';
export const BADGE_WARN =
  'border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300';
export const BADGE_NEG =
  'border border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300';

/** Period-over-period delta pill. Emerald = positive, red = negative (both themes). */
export function DeltaBadge({ delta, suffix = '', invert = false }: { delta: number; suffix?: string; invert?: boolean }) {
  const good = invert ? delta < 0 : delta >= 0;
  const sign = delta >= 0 ? '+' : '';
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-semibold ${good ? BADGE_POS : BADGE_NEG}`}>
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
    <div className="rounded border border-slate-200 bg-white p-2 text-xs shadow-lg dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100">
      {label && <div className="mb-1 font-semibold">{label}</div>}
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-4">
          <span className="text-slate-500 dark:text-slate-400">{k}</span>
          <span className="font-mono font-semibold">{v}</span>
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
      <span className="h-2 min-w-8 flex-1 overflow-hidden rounded bg-slate-100 dark:bg-slate-700">
        <span
          className="block h-full rounded"
          style={{ width: `${w}%`, background: neg ? '#EF4444' : '#10B981', marginLeft: neg ? 'auto' : undefined }}
        />
      </span>
      <span className="w-14 shrink-0 text-right font-mono text-xs">{pct(value)}</span>
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
        className="h-full w-full max-w-xl overflow-y-auto border-l border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-navyCard dark:text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold">{title}</h2>
          <button
            onClick={onClose}
            className="rounded border border-slate-300 px-2 py-1 text-sm dark:border-slate-600"
          >
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
