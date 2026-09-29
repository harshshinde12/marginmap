import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { Summary } from './api';
import { DeltaBadge, LoadingBlock, MetricBox, Sparkline, money, pct } from './components';

export function KpiBanner({
  lossDimension,
  lossLabel,
}: {
  lossDimension: 'product' | 'customer' | 'region';
  lossLabel: string;
}) {
  const summary = useQuery<Summary>({ queryKey: ['summary'], queryFn: api.summary });
  const trend = useQuery({ queryKey: ['kpi-trend', 6], queryFn: () => api.kpiTrend(6) });
  const loss = useQuery({
    queryKey: ['loss-count', lossDimension],
    queryFn: () => api.lossMakers(lossDimension, 1),
  });
  // Denominator comes live from existing endpoints (nothing hardcoded):
  // cost-to-serve n_entities for product/customer; region row count for region.
  const isRegion = lossDimension === 'region';
  const ctsTotal = useQuery({
    queryKey: ['cts-total', lossDimension],
    queryFn: () => api.costToServe(lossDimension as 'product' | 'customer', 1),
    enabled: !isRegion,
  });
  const regTotal = useQuery({
    queryKey: ['prof-region-count'],
    queryFn: () => api.profitability('region'),
    enabled: isRegion,
  });
  const total = isRegion ? regTotal.data?.rows.length : ctsTotal.data?.n_entities;
  if (summary.isLoading) return <LoadingBlock />;
  if (summary.error || !summary.data) return null;
  const d = summary.data;
  const pts = trend.data?.points ?? [];
  const rev = pts.map((p) => p.revenue);
  const grossPct = pts.map((p) => p.gross_pct * 100);
  const netPct = pts.map((p) => p.net_pct * 100);
  const netD = pts.map((p) => p.net);
  const last = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  const dRev = last && prev ? last.revenue - prev.revenue : 0;
  const dGrossPp = last && prev ? (last.gross_pct - prev.gross_pct) * 100 : 0;
  const dNetPp = last && prev ? (last.net_pct - prev.net_pct) * 100 : 0;
  const cards = [
    {
      label: 'Total Revenue (effective)',
      value: money(d.total_effective_sales),
      valueClass: 'text-ink dark:text-white',
      pill: <DeltaBadge delta={dRev} suffix="" />,
      spark: <Sparkline values={rev} />,
      sub: last ? `${last.month} vs ${prev?.month}` : '',
    },
    {
      label: 'Gross Margin %',
      value: pct(d.gross_margin_pct),
      valueClass: d.gross_margin_pct < 0 ? 'text-neg' : 'text-pos',
      pill: <DeltaBadge delta={Math.round(dGrossPp * 10) / 10} suffix="pp" />,
      spark: <Sparkline values={grossPct} />,
      sub: 'pp vs prior month',
    },
    {
      label: 'Net Margin %',
      value: pct(d.net_margin_pct),
      valueClass: d.net_margin_pct < 0 ? 'text-neg' : 'text-pos',
      pill: <DeltaBadge delta={Math.round(dNetPp * 10) / 10} suffix="pp" />,
      spark: <Sparkline values={netPct} />,
      sub: 'pp vs prior month',
    },
    {
      label: lossLabel,
      value:
        loss.data && total !== undefined
          ? `${loss.data.n_loss_makers.toLocaleString()} / ${total.toLocaleString()}`
          : '…',
      valueClass: 'text-ink dark:text-white',
      pill: <span className="text-xs text-slate-400 dark:text-[13px]">net &lt; $0, all time</span>,
      spark: <Sparkline values={netD} />,
      sub: 'monthly net $ context',
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map((k) => (
        <MetricBox key={k.label}>
          <div className="font-display text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">
            {k.label}
          </div>
          <div className={`mt-1 font-display text-2xl font-bold ${k.valueClass}`}>{k.value}</div>
          <div className="mt-1 flex items-center justify-between gap-2">
            {k.pill}
            {k.spark}
          </div>
          <div className="mt-1 text-[11px] text-slate-400 dark:text-[13px]">{k.sub}</div>
        </MetricBox>
      ))}
    </div>
  );
}
