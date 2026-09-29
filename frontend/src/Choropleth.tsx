import { useMemo, useState } from 'react';
import geo from './assets/us-states.json';
import { money, pct } from './components';

interface Feature {
  properties: { name: string };
  geometry: { type: string; coordinates: number[][][] | number[][][][] };
}

interface Props {
  values: Map<string, { net: number; net_pct: number; revenue: number }>;
}

export interface ColorDomain {
  maxAbs: number;
  lo: number;
  hi: number;
}

/** Color domain from the RENDERED (US-matched) states only — global outliers
 *  (e.g. tiny foreign provinces at ±200%) must not wash out the US scale.
 *  Missing/NaN entries are skipped, never zero-filled. */
export function colorDomain(
  values: Map<string, { net_pct: number }>,
  names: string[],
): ColorDomain {
  let maxAbs = 0;
  let lo = 0;
  let hi = 0;
  for (const name of names) {
    const v = values.get(name);
    const p = v?.net_pct;
    if (typeof p !== 'number' || Number.isNaN(p)) continue;
    if (Math.abs(p) > maxAbs) maxAbs = Math.abs(p);
    if (p < lo) lo = p;
    if (p > hi) hi = p;
  }
  return { maxAbs: maxAbs || 1, lo, hi };
}

/** Continental-US choropleth from bundled PublicaMundi boundary data (D8).
 *  Keys are full state names; values come live from /profitability?group_by=state.
 *  Alaska / Hawaii / Puerto Rico have no orders and render as no-data. */
export function Choropleth({ values }: Props) {
  const [hover, setHover] = useState<string | null>(null);
  const features = (geo as { features: Feature[] }).features;

  const { paths, maxAbs, lo, hi } = useMemo(() => {
    // Equirectangular fit over continental bounds.
    let minX = 1e9;
    let maxX = -1e9;
    let minY = 1e9;
    let maxY = -1e9;
    const polys: { name: string; rings: number[][][] }[] = [];
    for (const f of features) {
      const name = f.properties.name;
      const rings: number[][][] = [];
      if (f.geometry.type === 'Polygon') {
        for (const ring of f.geometry.coordinates as number[][][]) {
          rings.push(ring);
          for (const [x, y] of ring) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      } else {
        for (const poly of f.geometry.coordinates as number[][][][]) {
          for (const ring of poly) {
            rings.push(ring);
            for (const [x, y] of ring) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }
      }
      polys.push({ name, rings });
    }
    const W = 960;
    const H = 560;
    const sx = W / (maxX - minX);
    const sy = H / (maxY - minY);
    const s = Math.min(sx, sy);
    const ox = (W - (maxX - minX) * s) / 2;
    const oy = (H - (maxY - minY) * s) / 2;
    const pathStr = (rings: number[][][]) =>
      rings
        .map((ring) => ring.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${((x - minX) * s + ox).toFixed(1)},${((maxY - y) * s + oy).toFixed(1)}`).join(' ') + 'Z')
        .join(' ');
    const names = polys.map((p) => p.name);
    const domain = colorDomain(values, names);
    return { paths: polys.map((p) => ({ name: p.name, d: pathStr(p.rings) })), maxAbs: domain.maxAbs, lo: domain.lo, hi: domain.hi };
  }, [features, values]);

  const color = (netPct: number | undefined) => {
    if (netPct === undefined) return '#E5E7EB';
    const t = Math.min(1, Math.abs(netPct) / Math.max(maxAbs, 0.05));
    // Emerald positive / red negative, darker = larger |margin| (fixed across themes, D1).
    return netPct >= 0 ? `rgba(16,185,129,${0.25 + 0.75 * t})` : `rgba(239,68,68,${0.25 + 0.75 * t})`;
  };

  const hv = hover ? values.get(hover) : undefined;
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-[13px] dark:text-slate-400">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-10 rounded" style={{ background: 'linear-gradient(to right, rgba(239,68,68,0.25), rgba(239,68,68,1))' }} />
          Loss {pct(lo)} → darker = larger loss
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-10 rounded" style={{ background: 'linear-gradient(to right, rgba(16,185,129,0.25), rgba(16,185,129,1))' }} />
          Margin {pct(0)} → {pct(hi)} darker = higher margin
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded border border-slate-300" style={{ background: '#E5E7EB' }} />
          No data
        </span>
      </div>
      <svg viewBox="0 0 960 560" className="w-full rounded border border-slate-200 dark:border-slate-700" role="img" aria-label="US state net margin choropleth">
        {paths.map((p) => {
          const v = values.get(p.name);
          return (
            <path
              key={p.name}
              d={p.d}
              fill={color(v?.net_pct)}
              stroke={v ? '#ffffff' : '#D1D5DB'}
              strokeWidth={1.25}
              onMouseEnter={() => setHover(p.name)}
              onMouseLeave={() => setHover(null)}
              style={{ transition: 'fill 175ms', cursor: 'pointer' }}
            >
              <title>{`${p.name}: ${v ? `${money(v.net)} (${pct(v.net_pct)})` : 'no orders'}`}</title>
            </path>
          );
        })}
      </svg>
      <div className="mt-1 flex items-center justify-between text-xs text-slate-500 dark:text-[13px] dark:text-slate-400">
        <span>
          {hover ? (
            <>
              <strong className="text-ink dark:text-white">{hover}</strong>
              {hv ? (
                <> — Revenue {money(hv.revenue)}, Net Margin {money(hv.net)} ({pct(hv.net_pct)})</>
              ) : (
                ' — no orders in the data'
              )}
            </>
          ) : (
            'Hover a state for State, Revenue $, Net Margin $ and % (D5).'
          )}
        </span>
        <span>AK / HI / PR: no orders → no-data.</span>
      </div>
    </div>
  );
}
