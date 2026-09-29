# MarginMap — Profitability & Cost-to-Serve Analytics

Develop a profitability analytics system to calculate cost-to-serve and margin by product, channel,
customer, and region (Global Superstore dataset: 51,290 order lines, 2011-01 → 2014-12).

Verified totals (post-correction): effective sales **$11,823,482**, gross **$1,349,557 (11.4%)**,
net **−$659,784 (−5.6%)**.

## Tech stack

Backend (see `backend/requirements.txt`, versions verified against the installed environment):

| Package | Version | Used for |
|---|---|---|
| FastAPI | 0.141.1 | API (`app/main.py`; TestClient via its Starlette dep) |
| uvicorn | 0.53.0 | Dev server |
| pandas | 2.3.3 | Ingest (`app/ingest.py`) |
| openpyxl | 3.1.5 | Reading `data/superstore.xlsx` |
| pytest | 9.1.1 | Backend suite (58 tests) |
| httpx | 0.28.1 | Required by Starlette `TestClient` |

Storage is plain `sqlite3` (stdlib — no ORM); DDL uses standard SQL types so the same schema runs
on PostgreSQL (assumption A9).

Frontend (`frontend/package.json`): React + React DOM 18.3.1, Vite 5.4.8, TypeScript 5.6.2,
Tailwind CSS 3.4.13, Recharts 2.13.0, React Query 5.59.0, Vitest 2.1.3.

## Dataset & derivation rules

- Raw dataset: `data/superstore.xlsx` (committed — ~8 MB; without it a fresh clone cannot build
  anything) — source: Kaggle "Global Superstore" dataset. Three sheets: Orders (51,290 rows —
  used: every margin line), Returns (1,173 rows — used: Order IDs flagged as returned, A5),
  People (unused: salesperson → Region mapping; ingest ignores it). Built database
  `data/marginmap.db` is gitignored and regenerable via ingest.
- One-line derivations (full plain-language detail at `GET /assumptions`, `/phase2-assumptions`,
  `/ui-assumptions` — 27 D-items, D1 through D27 — not repeated here):
  - COGS_original = Sales_original − native Profit (A1; validated ≥ $0 on all 51,290 rows).
  - Support pool = 5% of total ORIGINAL sales, allocated strictly ∝ original sales per line,
    including returned lines (A3/A4; override via `MARGINMAP_SUPPORT_RATE_PCT`, re-run ingest).
  - Returned lines reverse the sale (sales_effective = COGS_effective = gross = 0); Return Cost =
    $8.00 flat fee only, no COGS term (A6 corrected rule).
  - Channel = Segment; freight is a direct per-line charge (A4/A7).

## Run locally

```powershell
# 1. Backend (from repo root)
Set-Location backend
pip install -r requirements.txt
python -m app.ingest          # builds data/marginmap.db from data/superstore.xlsx
python -m uvicorn app.main:app --port 8000   # http://127.0.0.1:8000 (/docs for live API docs)

# 2. Frontend (second terminal, from repo root)
Set-Location frontend
Copy-Item .env.example .env   # VITE_API_URL=http://127.0.0.1:8000
npm install
npm run dev                   # http://127.0.0.1:5173
```

Env vars: `MARGINMAP_SUPPORT_RATE_PCT` (backend, default `0.05` — re-run ingest after changing);
`VITE_API_URL` (frontend build-time API base URL);
`DATABASE_URL` (backend — unset = local SQLite; set = Supabase Postgres, see below).

## Supabase (Postgres) backend

Supabase hosts the **database only** — the FastAPI service stays on Render and the
Vite build stays a static site; both keep working unchanged. The API speaks to
either SQLite or Postgres through a thin compat shim (`backend/app/database.py`:
`?`→`%s`, `[brackets]`→`"quotes"`, `datetime('now')`→`CURRENT_TIMESTAMP`,
`AUTOINCREMENT`→identity PK; rows behave like `sqlite3.Row`). No query logic changed.

```powershell
# 1. Supabase dashboard -> Settings -> Database -> Connection string
#    -> Session Pooler: copy the URL, insert your DB password
#    (URL-encode special chars), keep ?sslmode=require.
# 2. From backend/ with a fresh local DB:
Set-Location backend
python -m app.ingest
$env:DATABASE_URL = "postgresql://postgres.<ref>:<pwd>@aws-0-<region>.pooler.supabase.com:6543/postgres?sslmode=require"
python -m app.load_supabase   # rebuilds order_margins, merges flags, verifies counts + sums
# 3. Render dashboard -> marginmap-api -> Environment -> add the same
#    DATABASE_URL (render.yaml declares it sync:false so it never lands in git)
#    -> redeploy. Verify /health and /reconciliation:
#    sales $11,823,482 / gross $1,349,557 (11.4%) / net -$659,784 (-5.6%).
```

Notes: session pooler (port 6543) avoids prepared-statement quirks — use it, not
the transaction pooler. Keep the DB password and any `sb_secret_*` key out of git
and chat; rotate a key in Supabase Settings -> API Keys if it was ever exposed.
Local dev and tests simply leave `DATABASE_URL` unset (SQLite fallback).

## Tests

```powershell
Set-Location backend; python -m pytest tests/ -v     # 58 tests
Set-Location frontend; npm test                        # 19 vitest tests
Set-Location frontend; npm run build                   # tsc --noEmit && vite build
```

Key endpoints (all 26 routes in `backend/app/main.py`): `/health /summary /reconciliation`
`/profitability?group_by=segment|category|sub_category|region|market|ship_mode|product|customer|state`
`/orders /orders/by-id/{order_id} /cost-to-serve?dimension=customer|product /loss-makers`
`/discount-impact /elasticity POST /simulate /variance?month=YYYY-MM /assumptions`
`/phase2-assumptions /ui-assumptions (D1–D27) /months /kpi-trend /margin-heatmap /entity-trend`
`/cost-structure /treemap /frequency-heatmap /drill-tree POST/GET/PATCH /flags`.
Full docs: `http://127.0.0.1:8000/docs`.

## Add-on visuals (all numbers trace to live API fields, no mocked data)

- Treemap (Overview): `GET /treemap` — rectangles sized by effective revenue, colored by net %; Category → Sub-Category nets reconcile to `/summary` (D20).
- US-only state leaderboards (Region sub-view): live `GET /profitability?group_by=state` filtered to the 49 choropleth boundary names, Top-5 / Bottom-5 by net $ (D23).
- Frequency × cost-tier heatmap (Cohorts): `GET /frequency-heatmap` — customer line-count bands × cost-to-serve tertiles, cells show customer count + avg net % (D21).
- Loss-maker Pareto (Loss-Maker Alerts): worst-first `GET /loss-makers` rows with cumulative share of loss-maker net, computed client-side (D24).
- Root-cause distribution (Loss-Maker Alerts): tag-key counts across the same `/loss-makers` rows (D12 thresholds), computed client-side (D25). The detail drawer shows one fixed-text rule-based suggestion per fired tag, none when no tag fires (D27).
- Tornado sensitivity (Simulator): 8 parallel `POST /simulate` calls at ±1pp / ±1% holding other sliders, deltas vs the current slider scenario, ranked by |delta|, clamped sides labeled (D22/D26).

## Locked margin formulas (exactly as implemented in `backend/app/allocation.py`)

- `Gross Margin = sales_effective − cogs_effective` (both are 0 on returned lines, so returned
  gross is 0). `Gross % = Gross ÷ sales_effective`, 0 when effective sales are 0.
- `Net Margin = Gross − Shipping Cost − allocated_support − return_cost`.
  `Net % = Net ÷ sales_effective`, 0 when effective sales are 0.
- Aggregates always compute percentages from summed dollars, never by averaging percentages.
- Phase 2 sits strictly below/around these formulas and never changes them: contribution =
  sales_effective − cogs_effective − shipping; net = contribution − support − return_cost.

## Architecture (text)

```
data/superstore.xlsx ── ingest ──► data/marginmap.db (order_margins, 51,290 rows + flags table)
                                         │  sales_effective/cogs_effective = 0 on returned lines
backend/app: allocation.py (pure math) ─┼──► main.py (FastAPI) ──► cockpit (Vite build)
              phase2.py (bands/cohorts/sim/variance narrative)
frontend/src: pages ×6 (Overview, DrillDown, Cohorts, LossMakers, Simulator, Variance)
```

## Scope decisions / known limitations (from the documented assumptions, not memory)

- Support pool (5% of original sales) is a synthetic assumption; the business reads net-negative
  largely because freight ($1.35M) alone exceeds gross ($1.35M) before support/returns (A3).
- Discount/contribution correlation (~−0.84) is mechanical (discount lowers effective sales against
  fixed unit COGS), not a finding — the band table (flat volume, collapsing contribution) is the evidence (B5).
- Simulator is a directional what-if (band-average volume response, constant unit costs), weakest for
  below-cost items; scenario sliders are labeled manual overrides (B6/D15).
- Cohorts split at medians; tiny entities can show extreme net % — drill into dollars before acting.
- Status badges / root-cause tags use quartile-derived cutoffs (Critical below −22.6%, Moderate to
  −4.3%; High Discounting above 21.7% mean discount), not round numbers (D11/D12).
- US-only choropleth (49 states with orders; AK/HI/PR render as no-data; non-US stays in bar/table
  views) joined to bundled real boundary data (D8).
- Single currency (USD) — no conversion with a made-up rate exists anywhere (D14).
- Variance compares Actual vs Prior Month vs Prior Year with real deltas; no Budget line exists in
  the data, so none is shown (D16).
- Export = real CSV download / browser print-to-PDF; no email is sent anywhere (D4).
- Deployment configs (`Dockerfile`, `render.yaml`) are provided but a live public deploy was not
  executed in this environment (no cloud credentials); verify `VITE_API_URL` points at the deployed API.

## Deliverables mapping (brief → repo)

Brief deliverables (from the project brief PDF in repo root):

1. **Cost allocation model and reproducible calculations** → `backend/app/allocation.py` (pure math) +
   `backend/app/ingest.py` (workbook → SQLite) + `GET /reconciliation` (live proof allocations sum
   out) + `backend/tests/test_allocation.py`.
2. **Profitability dashboards with scenario controls** → `frontend/src` (6 cockpit tabs) backed by
   `/profitability /cost-to-serve /loss-makers /discount-impact /elasticity /variance`, with
   scenario controls wired to `POST /simulate` (discount + price/COGS/shipping/volume sliders).
3. **Recommendations deck for pricing and portfolio actions** → draft bullets below (per findings);
   a generated C-Suite Deck remains a deferred stretch goal (D4) — the variance narrative
   (`/variance`) and loss-maker flags/exports are the implemented machine-readable equivalents.

## Recommendations-deck bullets (draft content, per findings)

1. Stop funding deep discounts: 30%+ bands hold ~20% of lines but destroy contribution (−57% to −70%)
   with no volume lift (3.27–3.49 vs 3.40 units/line at 0%). Cap discretionary discount at 20%.
2. Fix-or-exit the tail: 5,934/10,292 products are net-negative; start with the worst 50
   (freight-led, e.g. Cubify 3D Printer −$10.1k, freight 55% of serve cost) — renegotiate freight,
   raise price, or delist.
3. Attack freight first: it is the #1 serve-cost driver on top loss-makers (55–70%) and exceeds total
   gross in aggregate. Audit ship-mode mix on heavy/bulky Technology SKUs.
4. Protect Home Office (−4.9% net, best channel) and replicate its discount discipline elsewhere.
5. Treat the simulator as directional only; pilot the worked printer repricing (53%→10%) on one region
   before rollout — the model assumes volume holds at ~2× price.
