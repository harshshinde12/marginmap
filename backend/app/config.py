"""Phase 1 assumptions — single source of truth.

Locked by user decisions. Plain language, no code logic hidden here.
"""
from __future__ import annotations

import os


def get_support_rate_pct() -> float:
    """Named config parameter. Override with env var MARGINMAP_SUPPORT_RATE_PCT.

    Default 0.05 (5%). Read dynamically so GET /assumptions and ingest
    always reflect the live value, never a hardcoded string.
    """
    try:
        return float(os.getenv("MARGINMAP_SUPPORT_RATE_PCT", "0.05"))
    except ValueError:
        return 0.05


# Live value at import time (ingest + API call get_support_rate_pct() per run/request).
SUPPORT_RATE_PCT: float = get_support_rate_pct()
SUPPORT_RATE: float = SUPPORT_RATE_PCT  # backwards-compatible alias

# Flat reverse-logistics fee per RETURNED order line.
RETURN_FEE = 8.0

# Brief field "channel" is mapped to dataset field "Segment".
CHANNEL_FIELD = "Segment"
CHANNEL_VALUES = ("Consumer", "Corporate", "Home Office")

# Locked margin formulas (Sales is already net of discount):
#   Normal line:   Gross = Sales - COGS; Net = Gross - Shipping - Support - Return
#   Returned line (CORRECTED rule): sale reversed for margin purposes, so
#     Sales_effective = 0, COGS_effective = 0, Gross = 0;
#     Return Cost = $8 flat fee ONLY; support still allocated on ORIGINAL Sales;
#     Net = 0 - Shipping - Support - 8. Margin %s are 0 on returned lines
#     (no divide-by-zero); aggregates compute %s from summed dollars.
# Native Profit field is ignored except as a sanity check.


def get_assumptions() -> list[str]:
    """Build the assumption list dynamically from the live config value."""
    pct = get_support_rate_pct()
    return [
        "A1 COGS is derived, not synthetic: COGS_original = Sales_original - native Profit. "
        "Justification: Superstore's native Profit equals Sales-after-discount minus COGS, "
        "excluding Shipping Cost. Validated: 0 of 51290 rows produce negative COGS_original (min $0.55).",
        "A2 Sales_original is already net of discount. Discount is never subtracted again. "
        "Discount % is kept as an attribute for Phase 2 pricing analysis only.",
        f"A3 Shared support-cost pool = {pct:.2%} of total ORIGINAL Sales "
        f"(named parameter SUPPORT_RATE_PCT = {pct}, env override MARGINMAP_SUPPORT_RATE_PCT). "
        "This is a synthetic assumption (dataset has no support costs). "
        "Pool is allocated to lines strictly proportional to ORIGINAL Sales, "
        "so allocated_support = rate * Sales_original per line — including returned lines.",
        "A4 Allocation key for shared costs is ORIGINAL-Sales proportion only. "
        "Freight (Shipping Cost) is a direct per-line charge, no allocation. "
        "Return Cost is a direct per-line charge, no allocation.",
        "A5 Returns: a separate Returns table EXISTS in the download (workbook sheet 'Returns', "
        "1173 rows / 1172 unique Order IDs; US-2014-136679 appears twice with conflicting Market). "
        "Join is on Order ID (left join; all IDs match). "
        "An Order ID with N lines that is returned flags all N lines as returned (3050 lines, 5.95%).",
        "A6 CORRECTED (double-count fix): returned lines reverse the sale for margin purposes — "
        "Sales_effective = 0, COGS_effective = 0, Gross = 0. "
        "Return Cost per returned line = $8.00 flat reverse-logistics fee ONLY "
        "(the old '+ COGS' term is removed). Non-returned lines have Return Cost = $0. "
        "The $8 fee is counted ONLY inside Return Cost, NOT in the support pool.",
        "A7 Channel = Segment (Consumer / Corporate / Home Office). Ship Mode and Market are kept as separate attributes.",
        "A8 Native Profit is ignored in margin math; used only as sanity check that COGS derivation holds (COGS_original>=0).",
        "A9 SQLite is the dev database (file data/marginmap.db). "
        "DDL uses standard SQL types so the same schema runs on PostgreSQL with no logic change.",
    ]


ASSUMPTIONS: list[str] = get_assumptions()


def get_phase2_assumptions() -> list[str]:
    """Phase 2 assumption list (plain language, kept next to code)."""
    return [
        "B1 Contribution margin (DEVIATION from build guide, required by locked Phase 1 rule): "
        "contribution = sales_effective - cogs_effective - shipping. "
        "The guide's `sales - discount_amount - cogs - variable` would subtract discount twice "
        "because Phase 1 Sales is already net of discount. Support and return fees sit below "
        "contribution: net = contribution - support - return_cost.",
        "B2 Cost-to-serve per entity = shipping + allocated_support + return_cost (COGS excluded; "
        "it would otherwise dominate every driver ranking and hide the serve-cost story).",
        "B3 Cohorts split each axis at the MEDIAN across entities of that dimension "
        "(revenue axis = effective revenue, margin axis = net margin %); ties (>= median) count as high.",
        "B4 Loss-maker = entity with total net_margin < threshold (default 0). "
        "Biggest cost driver = largest share of cost-to-serve among freight / support / returns.",
        "B5 Elasticity-lite bands are 0%, 1-10%, 11-20%, 21-30%, 30%+ on the dataset Discount field. "
        "REFRAME (verified correction): the ~-0.84 discount/contribution correlation is a MECHANICAL "
        "byproduct of the formula — discount lowers effective sales while unit COGS is fixed, so "
        "contribution must fall as discount rises by construction. It is NOT an empirical finding and must "
        "never headline a recommendation or variance narrative. The real insight is the band table itself: "
        "volume stays flat as discount rises while contribution collapses. "
        "Band/quantity differences remain confounded by category and customer mix (no causal claim).",
        "B6 Simulator volume response = ratio of average quantities between the new-discount band "
        "and the current-discount band within the entity's majority segment "
        "(mode of Segment over the entity's lines; segment entities use their own bands). "
        "Unit net price scales as (1-new_d)/(1-current_d); unit COGS and unit shipping held constant; "
        "baseline uses NON-returned lines only. Directional planning aid, not a forecast.",
        "B7 discount_amount (implied pre-discount value) is recovered as "
        "sales_net / (1 - d) * d for reporting context only; it never re-enters margin math.",
        "B8 Endpoint paths stay at root level (/cost-to-serve, not /api/cost-to-serve) to avoid "
        "breaking the Phase 1 paths the user already verified.",
    ]


PHASE2_ASSUMPTIONS: list[str] = get_phase2_assumptions()


# ---- UI/UX enhancement phase: data-derived thresholds (measured 2026-09-26) ----
# Product net_pct (10,222 revenue>0 products): p25 = -0.2259, p50 = -0.0433.
BADGE_CRITICAL_BELOW = -0.226  # bottom quartile
BADGE_MODERATE_BELOW = -0.043  # below median
# Product mean-discount p75 = 0.2167; return-line-rate p90 = 0.20 (24% of products
# have any return); freight-share-of-serve-cost p75 = 0.7103.
TAG_HIGH_DISCOUNT_ABOVE = 0.217
TAG_EXCESS_RETURNS_ABOVE = 0.20
TAG_LOGISTICS_SURGE_ABOVE = 0.71

COHORT_DISPLAY = {
    "high-revenue/high-margin": "Star",
    "high-revenue/low-margin": "Margin Risk",
    "low-revenue/high-margin": "Hidden Gem",
    "low-revenue/low-margin": "Low Priority",
}

FLAG_ENTITY_TYPES = ("product", "customer", "region", "segment", "category")
FLAG_STATUSES = ("open", "resolved", "dismissed")


def get_ui_assumptions() -> list[str]:
    """UI-enhancement assumption list (plain language). Live at GET /ui-assumptions."""
    return [
        "D1 Palette: emerald #10B981 = positive net margin, red #EF4444 = negative, on every chart. "
        "Transitions are 150-200ms on nav/tab switches only; no animation delays numbers.",
        "D2 KPI delta pills compare the latest month vs its prior month; sparklines plot the last 6 "
        "monthly values from GET /kpi-trend, which reuses the /variance month grouping (Order Date).",
        "D3 Date filter lists only real YYYY-MM values present in the data (GET /months, 48 months "
        "2011-01..2014-12). No YTD/QTD framing: the data is historical, so a fake 'today' is refused.",
        "D4 Export = real file downloads of the current view: CSV via client-side Blob of fetched rows, "
        "PDF via browser print-to-PDF. No email is sent anywhere. A generated C-Suite Deck is deferred "
        "as a stretch goal, not half-built.",
        "D5 Chart hover popovers show Revenue, COGS, Shipping, Support, Return Cost, Net $ and % taken "
        "directly from the datum of the response backing that chart — never recomputed.",
        "D6 Profit bridge is display-only: Gross List Price = SUM over lines of "
        "sales_effective / (1 - Discount). The locked Phase 1 Net Margin formula is untouched everywhere.",
        "D7 Heatmap cells show net_margin_pct; the full matrix's net dollars sum to the Phase 1 summary "
        "net (test-asserted). Product-row mode pages worst-first with limit/offset.",
        "D8 Choropleth covers US rows only (Country = 'United States', 9,994 lines, 49 states with orders; "
        "Alaska/Hawaii/Puerto Rico have no orders and render as no-data). Keys are full state names joined "
        "to bundled real boundary data (PublicaMundi us-states.geojson, 52 features). Non-US markets stay "
        "in bar/table views keyed by Market/Region — never placed on the map.",
        "D9 Cohort display names are cosmetic only and match the plotted Revenue x Margin "
        "axes: Star = high-revenue/high-margin, Margin Risk = "
        "high-revenue/low-margin, Hidden Gem = low-revenue/high-margin, Low Priority = "
        "low-revenue/low-margin. (Renamed from Protect/Optimize/Reprice/Fire-Eliminate, which "
        "misdescribed these axes as margin-x-cost.) "
        "Underlying median-split logic is unchanged.",
        "D10 Sankey freight split uses Ship Mode as proxy: Standard Class | First+Second Class | Same Day. "
        "This is a Ship Mode split, not a literal 'expedited' cost category — the data has no such field.",
        f"D11 Status badges use the product net_pct distribution (10,222 revenue>0 products, p25 = -0.2259, "
        f"p50 = -0.0433): Critical below {BADGE_CRITICAL_BELOW:.1%} (bottom quartile), Moderate "
        f"{BADGE_CRITICAL_BELOW:.1%} to {BADGE_MODERATE_BELOW:.1%} (below median), Warning "
        f"{BADGE_MODERATE_BELOW:.1%} to 0%. Cutoffs are quartile-derived, not round numbers.",
        f"D12 Root-cause tags are rule-based with the measured value shown: High Discounting when entity "
        f"mean discount > {TAG_HIGH_DISCOUNT_ABOVE:.1%} (p75 of product mean discounts = 0.2167); Excessive "
        f"Returns when returned-line rate > {TAG_EXCESS_RETURNS_ABOVE:.0%} (p90 = 0.20; only 24% of products "
        f"have any return); Logistics Surge when freight share of cost-to-serve > {TAG_LOGISTICS_SURGE_ABOVE:.0%} "
        f"(p75 = 0.7103). Multiple tags may apply.",
        "D13 'Flag for Review' persists to a real flags table (entity_type, entity_id, status, note, "
        "flagged_at) via POST/GET/PATCH /flags; re-ingest preserves flags. 'Export to Sales Team' downloads "
        "the real filtered table as CSV (Blob) or PDF (print) — no email integration exists.",
        "D14 Single currency (USD) only. Any currency switcher in the UI is visibly disabled and labeled "
        "'coming soon' — no conversion with a made-up rate is performed anywhere.",
        "D15 Simulator scenario sliders extend the Phase 2 projection: Price Adjustment scales unit net "
        "price (range -90%..+200%); COGS Reduction scales unit COGS (0..90%); Shipping Subsidy Cut scales "
        "borne unit shipping (0..90%); Volume Override multiplies band-derived volume (0.1x..5.0x, default "
        "1.0x = pure band elasticity, labeled 'manual override'). Baseline and ranges are echoed in the "
        "response; still directional, not a forecast.",
        "D16 Variance tornado compares Actual vs Prior Month vs Prior Year (same month -1 year where in "
        "range) with real deltas only. The dataset contains no budget/target column, so no Budget line is "
        "shown — a synthetic target would be fabricated data.",
        "D17 Prior-year comparison is null for the first 12 data months (2011-01..2011-12 have no "
        "same-month prior year in range). The tornado always shows Actual vs Prior Month; the Prior Year "
        "bar renders only when /variance returns a non-null prior_year.",
        "D18 GET /entity-trend scopes the /variance calendar-month grouping to one entity id; months are "
        "ascending and sparse (only months where the entity has lines). Unknown ids return 404. "
        "net_pct is 0 when that month's revenue is 0 (returned-only months).",
        "D19 Flags default to status 'open' with empty note; PATCH updates only the fields sent. "
        "GET /flags filters are exact matches (entity_type lowercased). The flags table is created "
        "on first API use if missing and is never dropped by re-ingest.",
        "D20 Treemap sizes rectangles by effective revenue and colors by net margin % "
        "(emerald positive, red negative). Category nodes nest their Sub-Categories; every level's "
        "net dollars sum to the Phase 1 summary net (test-asserted).",
        "D21 Frequency x cost heatmap is customer-scoped: frequency = order-line count per customer "
        "in bands 1-2 / 3-5 / 6-10 / 10+; cost tiers are tertiles of cost-to-serve across all "
        "customers (thresholds echoed in the response). Each cell shows customer count and average "
        "net margin % (cell net / cell revenue); cell nets sum to the summary net.",
        "D22 Tornado sensitivity reuses /simulate with ±1 percentage-point independent shifts "
        "(price_adj, cogs_red, ship_cut) and ±1% relative volume (vol_override), holding other "
        "scenario sliders at their current values. COGS/shipping accept down to -0.10 (a 10% cost "
        "increase) for sensitivity use only; levers are ranked by absolute contribution delta.",
        "D23 Region leaderboards are US-ONLY Top-5 / Bottom-5 states by net dollars: the live "
        "GET /profitability?group_by=state response (limit 2000 covers all 1,094 global states, "
        "net DESC) filtered to the choropleth boundary names (us-states.json, 49 matched; "
        "US names are unique in the data with 0 non-US overlap, so no merged cross-country "
        "duplicate can appear). All-time dollars. No new endpoint.",
        "D24 Loss-maker Pareto is display-only: worst-first /loss-makers rows (net < $0) with "
        "cumulative share of total loss-maker net dollars. Computed client-side from the live "
        "response fields (eid, net); no new endpoint, no invented totals.",
        "D25 Root-cause distribution counts tag keys across the same /loss-makers rows "
        "(high_discount / excess_returns / logistics_surge per D12, plus untagged). Computed "
        "client-side from the live tags arrays; no new endpoint.",
        "D26 Simulator tornado frontend reuses D22 shifts live via /simulate (no new endpoint): "
        "each lever is shifted independently while the other sliders stay at their current "
        "values, and levers are ranked by absolute contribution delta. COGS/shipping sliders "
        "span -10%..+90% to match the backend sensitivity floor.",
        "D27 Loss-maker drawer shows one fixed-text rule-based suggestion under each root-cause "
        "tag (High Discounting -> review the discount ceiling; Excessive Returns -> investigate "
        "return causes; Logistics Surge -> review ship mode and freight terms). No projected "
        "savings, no numbers beyond the measured tag values; entities with no tags show no "
        "suggestions.",
    ]


UI_ASSUMPTIONS: list[str] = get_ui_assumptions()
