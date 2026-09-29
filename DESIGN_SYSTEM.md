# MarginMap Design System (implemented)

Visual-only pass. No calculation, API call, data shape, or business logic was
changed: every number renders exactly as returned by the API (`money`/`pct`
formatters untouched; `backend/`, `api.ts`, `format.ts`, `addon-helpers.ts`
untouched — verified via `git diff`). Emerald/red net-margin rule (D1) holds
everywhere.

## 1. Tokens (`frontend/tailwind.config.js`)

| Token | Value | Use |
|---|---|---|
| `navy` | `#0F172A` | Dark page bg |
| `navyCard` | `#1E293B` | Dark card surface |
| `navyCardHover` | `#243247` | Nested dark surface (expanded rows, inner panels) |
| `paper` | `#F1F5F9` | Light page bg |
| `ink` | `#0f172a` | Light headings / active pill bg |
| `neon` | `#3B82F6` | Sparingly: logo mark, active nav indicator, primary actions, key signal lines |
| `neonPurple` | `#8B5CF6` | Logo gradient end + variance average line only |
| `pos` | `#10B981` | Positive margin (never changed) |
| `neg` | `#EF4444` | Negative margin (never changed) |
| `accent` / `danger` | `#059669` / `#dc2626` | Cohort highlight / strongest-red emphasis |

## 2. Typography

- UI text: **Inter** (400/500/600/700) via Google Fonts, `font-display`/`font-body`.
- Numerals: **IBM Plex Mono** (`font-mono`), fallback Geist Mono → ui-monospace.
  Every dollar/percent value uses `font-mono tabular-nums` (`.font-mono` forces
  `tabular-nums` globally). KPI headlines use Inter + `tabular-nums` at large
  size; table/body numerals use the mono face.
- Strict scale (Tailwind `fontSize` override + `:root` vars in `index.css`):
  `xs 12 / sm 13 / base 14 / lg 16 / xl 20 / 2xl 28 / 3xl 36 / 4xl 40`.
  KPI headlines `text-4xl` (40px, 600–700); card titles `text-xs` uppercase
  `tracking-widest` at `opacity-60`; captions `text-xs`; tables `text-sm`
  (13px, dense but calm). No ad-hoc sizes remain (`text-[11px]` /
  `dark:text-[13px]` removed).
- Line-height `1.4` body; `leading-none/tight` on headlines.

## 3. Spacing & density

8px grid only: cards `p-4`, KPI cards `p-5`, page/section gaps `gap-3`/`gap-4`,
page gutter `p-4`/`lg:p-6`. Inner rows `p-2`/`p-3`.

## 4. Surfaces & elevation (`Card`, `MetricBox` in `components.tsx`)

- Resting: `rounded-xl` + 1px border (`border-black/5` light,
  `border-white/5` dark) + `shadow-card`
  (`0 1px 3px rgba(0,0,0,0.08), 0 1px 2px -1px rgba(0,0,0,0.06)`;
  dark: `shadow-card-dark`).
- Hover (cards only): border → `border-neon/30` + `shadow-card-hover`
  (`0 0 0 1px rgba(59,130,246,0.1), 0 8px 24px -8px rgba(0,0,0,0.3)`;
  dark: `…0.15…, …rgba(0,0,0,0.6)`).
- Lift (`hover:-translate-y-0.5`) lives **only** on KPI `MetricBox` cards.
  All data-dense surfaces (tables, chart cards, loss-maker articles, simulator
  result cards) have no lift.
- Radius: `rounded-xl` (12px) cards, `rounded-lg` (8px) inputs/selects/buttons/
  badges/cells, `rounded-full` pills only (cost-tier filter).
- Nested depth: inner panels use `bg-slate-50/60` light /
  `bg-white/[0.02]`–`bg-navyCardHover` dark instead of flat same-color stacking.

## 5. Color discipline

- Emerald/red for net sign kept in every chart, bar, badge, and cell.
- Decorative neon removed: donut cost buckets, Sankey flows, ship-mode and
  elasticity volume bars, and cost-breakdown bars now use the desaturated
  `COST_COLORS` slate ramp (`revenue #334155`, `cogs #475569`,
  `freight #64748B`, `freightHi #334155`, `freightLo/returns #94A3B8`,
  `baseline #64748B`) with amber `#F59E0B` kept only for Support/attention.
- Intentional neon exceptions (functional signal, not decoration): logo mark,
  sidebar/sub-tab active states, primary Run/Simulate/Flag buttons, simulated-
  series bars, cumulative-% and net-% signal lines, variance average marker.

## 6. Charts (Recharts)

- Grid: `{ stroke: '#94A3B8', strokeOpacity: 0.12, strokeDasharray: '3 3' }`
  (`GRID_PROPS`) on every `CartesianGrid`. Never solid.
- Axes: `tick={{ fontSize: 12, fill: '#64748B' }}` (`TICK_PROPS`),
  `tickLine={false} axisLine={false}` (`AXIS_PROPS`); value axes `tickCount={5}`,
  crowded category axes use `interval` + `minTickGap={8}`.
- Zero/average lines: `{ stroke: '#64748B', strokeDasharray: '4 4',
  strokeOpacity: 0.55 }` (`REF_LINE_PROPS`).
- Tooltips: one style everywhere — `ChartTooltip` (generic charts) and
  `RichTooltip` (cost-breakdown hovers) share the Card treatment:
  `rounded-xl`, `border-black/5`/`white/10`, `shadow-card-hover`, 12px Inter
  titles + mono tabular values. Waterfall `FallTip` and variance `TrendTip`
  were restyled to the same treatment. Formatters still emit the exact API
  numbers (`money`/`pct`).
- Sparklines: 1.5px stroke, gradient fill `stopOpacity 0.08 → 0`, no dots
  except a last-point dot at `group-hover:opacity-100`.
- Margin step scale (treemap, margin heatmap, frequency heatmap, choropleth):
  7 quantized stops, not interpolation — alphas
  `[0.10, 0.18, 0.30, 0.42, 0.56, 0.70, 0.85]` over `|net%|` edges
  `[0.02, 0.05, 0.10, 0.15, 0.20, 0.30]` (`marginCellBg`); `≈0` renders slate.
  Legend chips (`MARGIN_SCALE_LEGEND`): `≤−30 #991B1B`, `−15 #EF4444`,
  `−5 #FCA5A5`, `≈0 #64748B`, `+5 #6EE7B7`, `+15 #10B981`, `≥+30 #065F46`.

## 7. Navigation & header (`App.tsx`)

- Sidebar: `px-3 py-1.5`, 2px neon left-border active
  (`border-neon bg-neon/5 text-neon`) on transparent — no white pill.
- Sub-tab pills (DrillDown, Loss-Makers, Variance granularity):
  `SUBTAB_ACTIVE = bg-ink text-white / dark:bg-neon`,
  `SUBTAB_INACTIVE = slate-500→ink / dark slate-400→white`. No light-mode
  white-block actives remain.
- Header Export/Print/Theme are ghost (`border-transparent`, hover wash);
  Date Range is `h-9` with Chevron + `focus:ring-2 ring-neon/40`.

## 8. Form controls

- Sliders (`Simulator`): 4px track with neon fill to `--fill` percent
  (JS-set per value; Firefox via `::-moz-range-progress`), 14px thumb circle,
  `focus-visible` double ring. Same styling for all 5 sliders.
- Selects/inputs: `SELECT_CLASS` — `h-9 rounded-lg px-3 text-sm shadow-sm`,
  slate borders, `focus:ring-2 ring-neon/40` — applied to Date Range, sort,
  dimension, heatmap, loss-maker, variance, and entity controls.

## 9. Micro-interactions

- Zero artificial delay preserved. Loading states are dimension-matched
  skeletons with subtle pulse: `KpiSkeleton` (4-card banner grid),
  `ChartSkeleton(height)` (chart cards), `TableSkeleton(rows)` (tables/trees),
  generic `LoadingBlock`. No layout shift, no fake delay.
- Badges: `BADGE_POS/WARN/NEG` — `inline-flex rounded-lg border px-2 py-0.5
  text-xs font-semibold` — used directly everywhere (loss cards, drawer,
  tier cells); the old `rounded px-1.5 text-[11px]` wrappers were removed.
