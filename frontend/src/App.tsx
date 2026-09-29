import { useEffect, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { Cohorts } from './pages/Cohorts';
import { DrillDown } from './pages/DrillDown';
import { Overview } from './pages/Overview';
import { LossMakers } from './pages/LossMakers';
import { Simulator } from './pages/Simulator';
import { Variance } from './pages/Variance';
import { KpiBanner } from './KpiBanner';
import { ThemeProvider, useTheme } from './theme';
import { TabErrorBoundary } from './ErrorBoundary';
import { api } from './api';
import { printPDF } from './components';

const NAV = [
  { key: 'overview', label: 'Overview' },
  { key: 'drill', label: 'Product / Customer / Channel / Region' },
  { key: 'cohorts', label: 'Cost-to-Serve Cohorts' },
  { key: 'loss', label: 'Loss-Maker Alerts' },
  { key: 'sim', label: 'Pricing Simulator' },
  { key: 'variance', label: 'Variance Report' },
] as const;

type NavKey = (typeof NAV)[number]['key'];

const qc = new QueryClient();

export type ExportFn = () => void;

/** Drill sub-tab dimension, lifted to Shell so the shared KPI banner can reflect it. */
export type DrillDim = 'product' | 'customer' | 'segment' | 'region';

function Header({
  onExport,
  globalMonth,
  setGlobalMonth,
}: {
  onExport: () => void;
  globalMonth: string;
  setGlobalMonth: (m: string) => void;
}) {
  const { theme, toggle } = useTheme();
  const months = useQuery({ queryKey: ['months'], queryFn: api.months });
  return (
    <header className="sticky top-0 z-40 border-b border-black/5 bg-white/95 backdrop-blur-xl dark:border-white/5 dark:bg-navy/95">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 lg:px-6">
        <div className="mr-2 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-neon to-neonPurple font-display text-lg font-bold text-white">
            M
          </span>
          <div>
            <div className="font-display text-lg font-bold leading-tight tracking-tight text-ink dark:text-white">MarginMap</div>
            <div className="text-xs leading-tight text-slate-500 dark:text-slate-400">Executive Profitability Cockpit</div>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-300">
            Date Range
            <span className="relative inline-flex items-center">
              <select
                value={globalMonth}
                onChange={(e) => setGlobalMonth(e.target.value)}
                className="h-9 appearance-none rounded-lg border border-slate-200 bg-white/80 pl-3 pr-8 text-sm font-medium text-ink shadow-sm transition-all duration-175 focus:outline-none focus:ring-2 focus:ring-neon/40 dark:border-slate-700 dark:bg-navyCard dark:text-slate-100"
                title="Real calendar months from the data"
              >
                {(months.data?.months ?? []).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <svg className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </span>
            <DateInfo />
          </label>
          <button
            onClick={onExport}
            className="no-print rounded-lg border border-transparent px-3 py-1.5 text-sm font-medium text-slate-500 transition-all duration-175 hover:border-slate-200 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:border-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            title="Download the current tab as CSV (real data)"
          >
            Export CSV
          </button>
          <button
            onClick={printPDF}
            className="no-print rounded-lg border border-transparent px-3 py-1.5 text-sm font-medium text-slate-500 transition-all duration-175 hover:border-slate-200 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:border-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            title="Print / save as PDF via the browser"
          >
            Print / PDF
          </button>
          <button
            onClick={toggle}
            className="no-print rounded-lg border border-transparent px-3 py-1.5 text-sm font-medium text-slate-500 transition-all duration-175 hover:border-slate-200 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:border-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            title="Toggle dark / light theme (persisted)"
          >
            {theme === 'dark' ? '☀ Light' : '🌙 Dark'}
          </button>
        </div>
      </div>
    </header>
  );
}

function DateInfo() {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setOpen(false)}
        className="flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 text-xs font-bold text-slate-500 transition-all duration-175 hover:border-neon hover:text-neon dark:border-slate-600 dark:text-slate-300"
        title="About the date filter"
        aria-label="About the date filter"
      >
        i
      </button>
      {open && (
        <span className="absolute right-0 top-6 z-50 block w-64 rounded-xl border border-black/5 bg-white p-2 text-xs font-normal normal-case text-slate-600 shadow-card-hover dark:border-white/10 dark:bg-navyCard dark:text-slate-200">
          Date filter lists real calendar months from the data and drives the Variance tab; all other tabs show
          all-time aggregates. No YTD/QTD — the data is historical (2011–2014).
        </span>
      )}
    </span>
  );
}

function Shell() {
  const [tab, setTab] = useState<NavKey>('overview');
  const [globalMonth, setGlobalMonth] = useState('2014-12');
  const [simTarget, setSimTarget] = useState<{ dimension: string; entityId: string } | null>(null);
  const [drillDim, setDrillDim] = useState<DrillDim>('product');
  const exportRef = useRef<ExportFn>(() => {});
  // 4th KPI card follows the drill sub-tab dimension (overall totals in all cases).
  // /loss-makers has no segment dimension, so Channel falls back to overall products.
  const kpiLoss =
    tab === 'drill' && drillDim === 'customer'
      ? { dimension: 'customer' as const, label: 'Loss-Making Customers' }
      : tab === 'drill' && drillDim === 'region'
        ? { dimension: 'region' as const, label: 'Loss-Making Regions' }
        : { dimension: 'product' as const, label: 'Loss-Making Products' };
  return (
    <div className="flex min-h-screen flex-col bg-paper lg:flex-row dark:bg-navy">
      <aside className="w-full shrink-0 border-b border-slate-200 bg-ink p-4 text-white lg:min-h-screen lg:w-64 lg:border-b-0 dark:bg-slate-950">
        <h1 className="font-display text-xl font-bold tracking-tight">MarginMap</h1>
        <p className="mt-0.5 text-xs text-slate-300">Executive Profitability Cockpit</p>
        <nav className="mt-4 flex flex-row flex-wrap gap-1 lg:flex-col lg:gap-0.5">
          {NAV.map((n) => (
            <button
              key={n.key}
              onClick={() => setTab(n.key)}
              className={`rounded-r-lg px-3 py-1.5 text-left text-sm transition-all duration-175 ${
                tab === n.key ? 'border-l-2 border-neon bg-neon/5 font-semibold text-neon' : 'border-l-2 border-transparent font-medium text-slate-400 hover:text-slate-100'
              }`}
            >
              {n.label}
            </button>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <Header onExport={() => exportRef.current()} globalMonth={globalMonth} setGlobalMonth={setGlobalMonth} />
        <main className="flex min-w-0 flex-1 flex-col gap-4 p-4 lg:p-6">
          <KpiBanner lossDimension={kpiLoss.dimension} lossLabel={kpiLoss.label} />
          <TabBody
            tab={tab}
            exportRef={exportRef}
            globalMonth={globalMonth}
            simTarget={simTarget}
            drillDim={drillDim}
            onDrillDimChange={setDrillDim}
            onSimulate={(dimension, entityId) => {
              setSimTarget({ dimension, entityId });
              setTab('sim');
            }}
          />
        </main>
      </div>
    </div>
  );
}

function TabBody({
  tab,
  exportRef,
  globalMonth,
  simTarget,
  drillDim,
  onDrillDimChange,
  onSimulate,
}: {
  tab: NavKey;
  exportRef: React.MutableRefObject<ExportFn>;
  globalMonth: string;
  simTarget: { dimension: string; entityId: string } | null;
  drillDim: DrillDim;
  onDrillDimChange: (d: DrillDim) => void;
  onSimulate: (dimension: string, entityId: string) => void;
}) {
  // Each tab registers its CSV exporter so the sticky header button exports the current view.
  const register = (fn: ExportFn) => {
    exportRef.current = fn;
  };
  useEffect(() => {
    exportRef.current = () => {};
  }, [tab, exportRef]);
  if (tab === 'overview') return <TabErrorBoundary tabName="Overview"><Overview registerExport={register} /></TabErrorBoundary>;
  if (tab === 'drill') return <TabErrorBoundary tabName="Product / Customer / Channel / Region"><DrillDown registerExport={register} dim={drillDim} onDimChange={onDrillDimChange} /></TabErrorBoundary>;
  if (tab === 'cohorts') return <TabErrorBoundary tabName="Cost-to-Serve Cohorts"><Cohorts registerExport={register} /></TabErrorBoundary>;
  if (tab === 'loss') return <TabErrorBoundary tabName="Loss-Maker Alerts"><LossMakers registerExport={register} onSimulate={onSimulate} /></TabErrorBoundary>;
  if (tab === 'sim') return <TabErrorBoundary tabName="Pricing Simulator"><Simulator registerExport={register} initial={simTarget} /></TabErrorBoundary>;
  return <TabErrorBoundary tabName="Variance Report"><Variance registerExport={register} initialMonth={globalMonth} /></TabErrorBoundary>;
}

export function App() {
  return (
    <QueryClientProvider client={qc}>
      <ThemeProvider>
        <Shell />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
