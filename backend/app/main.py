"""FastAPI backend — Phase 1 (data model + allocation engine API)."""
from __future__ import annotations

import re

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from app.config import (
    BADGE_CRITICAL_BELOW,
    BADGE_MODERATE_BELOW,
    CHANNEL_FIELD,
    COHORT_DISPLAY,
    FLAG_ENTITY_TYPES,
    FLAG_STATUSES,
    RETURN_FEE,
    TAG_EXCESS_RETURNS_ABOVE,
    TAG_HIGH_DISCOUNT_ABOVE,
    TAG_LOGISTICS_SURGE_ABOVE,
    get_assumptions,
    get_phase2_assumptions,
    get_support_rate_pct,
    get_ui_assumptions,
)
from app.cache import cache_response
from app.database import get_connection
from app.phase2 import (
    BAND_CASE_SQL,
    BAND_ORDER,
    build_variance_narrative,
    cohort_label,
    contribution,
    cost_driver,
    discount_band,
    entity_tags,
    median,
    pearson,
    simulate as simulate_math,
    status_badge,
)

app = FastAPI(title="MarginMap API — Phase 1")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

ALLOWED_GROUP_BY = {
    "segment": ("Segment", None),
    "category": ("Category", None),
    "sub_category": ("[Sub-Category]", None),
    "region": ("Region", None),
    "market": ("Market", None),
    "ship_mode": ("[Ship Mode]", None),
    "product": ("[Product ID]", "[Product Name]"),
    "customer": ("[Customer ID]", "[Customer Name]"),
    "state": ("State", None),
}

# Dimensions shared by cost-to-serve / loss-makers / simulator.
# value: (id column SQL, label column SQL or None)
DIMENSIONS = {
    "product": ("[Product ID]", "[Product Name]"),
    "customer": ("[Customer ID]", "[Customer Name]"),
    "region": ("Region", None),
    "segment": ("Segment", None),
    "category": ("Category", None),
}

SIMULATABLE = ("product", "customer", "segment", "category", "region")


def _ensure_flags_table(conn) -> None:
    """Create flags table if missing (same DDL as ingest; re-ingest never drops it)."""
    conn.execute(
        """CREATE TABLE IF NOT EXISTS flags (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               entity_type TEXT NOT NULL,
               entity_id TEXT NOT NULL,
               status TEXT NOT NULL DEFAULT 'open',
               note TEXT NOT NULL DEFAULT '',
               flagged_at TEXT NOT NULL DEFAULT (datetime('now'))
           )"""
    )
    conn.commit()


@app.get("/health")
def health():
    return {"status": "ok", "phase": 1}


@app.get("/assumptions")
def assumptions():
    # Built dynamically from the live SUPPORT_RATE_PCT value every request.
    return {
        "assumptions": get_assumptions(),
        "channel_field": CHANNEL_FIELD,
        "support_rate_pct": get_support_rate_pct(),
        "return_fee": RETURN_FEE,
    }


@app.get("/summary")
@cache_response
def summary():
    conn = get_connection()
    row = conn.execute(
        """
        SELECT COUNT(*) AS n_lines,
               SUM(Sales) AS total_original_sales,
               SUM(sales_effective) AS total_effective_sales,
               SUM(cogs_original) AS total_cogs_original,
               SUM(cogs) AS total_cogs,
               SUM(gross_margin) AS total_gross,
               SUM([Shipping Cost]) AS total_shipping,
               SUM(allocated_support) AS total_support,
               SUM(return_cost) AS total_return_cost,
               SUM(net_margin) AS total_net,
               SUM(is_returned) AS n_returned_lines
        FROM order_margins
        """
    ).fetchone()
    conn.close()
    d = dict(row)
    eff = d["total_effective_sales"] or 0
    d["gross_margin_pct"] = d["total_gross"] / eff if eff else 0
    d["net_margin_pct"] = d["total_net"] / eff if eff else 0
    d["support_rate_pct"] = get_support_rate_pct()
    return d


@app.get("/reconciliation")
@cache_response
def reconciliation():
    """Prove allocations reconcile on real data, bypassing nothing hidden."""
    conn = get_connection()
    row = conn.execute(
        """
        SELECT SUM(Sales) AS total_original_sales,
               SUM(sales_effective) AS total_effective_sales,
               SUM(cogs_original) AS total_cogs_original,
               SUM(cogs) AS total_cogs,
               SUM(gross_margin) AS total_gross,
               SUM(Profit) AS total_native_profit_all_lines,
               SUM(CASE WHEN is_returned = 0 THEN Profit ELSE 0 END) AS gross_from_native_profit_nonreturned,
               SUM([Shipping Cost]) AS total_shipping,
               SUM(allocated_support) AS total_support,
               SUM(return_cost) AS total_return_cost,
               SUM(net_margin) AS total_net,
               SUM(is_returned) AS n_returned_lines
        FROM order_margins
        """
    ).fetchone()
    conn.close()
    d = dict(row)
    rate = get_support_rate_pct()
    expected_net = (
        d["total_gross"] - d["total_shipping"] - d["total_support"] - d["total_return_cost"]
    )
    d["expected_net"] = expected_net
    d["unexplained_variance"] = d["total_net"] - expected_net
    d["net_matches"] = abs(d["unexplained_variance"]) < 0.01
    # Support pool is defined on ORIGINAL sales (returned orders still consumed handling).
    d["support_rate_pct"] = rate
    d["support_pool_definition"] = rate * d["total_original_sales"]
    d["support_recon_pct"] = (
        d["total_support"] / d["support_pool_definition"] * 100
        if d["support_pool_definition"]
        else 0
    )
    d["support_reconciles"] = abs(d["support_recon_pct"] - 100.0) < 1e-6
    # Return Cost must equal exactly $8 x returned lines (no COGS term).
    d["return_fee_each"] = RETURN_FEE
    d["return_cost_expected"] = RETURN_FEE * d["n_returned_lines"]
    d["return_matches"] = abs(d["total_return_cost"] - d["return_cost_expected"]) < 0.01
    # Gross must equal native Profit summed over NON-returned lines only.
    d["gross_matches_nonreturned_profit"] = (
        abs(d["total_gross"] - d["gross_from_native_profit_nonreturned"]) < 0.01
    )
    return d


@app.get("/profitability")
@cache_response
def profitability(
    group_by: str = Query(..., description="segment|category|sub_category|region|market|ship_mode|product|customer"),
    limit: int | None = Query(None, description="Max rows (default all; use with offset for product/customer)"),
    offset: int = 0,
):
    key = group_by.lower()
    if key not in ALLOWED_GROUP_BY:
        raise HTTPException(400, f"group_by must be one of {sorted(ALLOWED_GROUP_BY)}")
    col, label_col = ALLOWED_GROUP_BY[key]
    label_sql = f"MAX({label_col}) AS label," if label_col else ""
    paging = ""
    params: tuple = ()
    if limit is not None:
        paging = "LIMIT ? OFFSET ?"
        params = (limit, offset)
    conn = get_connection()
    rows = conn.execute(
        f"""
        SELECT {col} AS grp,
               {label_sql}
               COUNT(*) AS n_lines,
               SUM(is_returned) AS n_returned_lines,
               SUM(sales_effective) AS sales,
               SUM(Sales) AS sales_original,
               SUM(cogs) AS cogs,
               SUM(gross_margin) AS gross,
               SUM([Shipping Cost]) AS shipping,
               SUM(allocated_support) AS support,
               SUM(return_cost) AS return_cost,
               SUM(net_margin) AS net
        FROM order_margins
        GROUP BY {col}
        ORDER BY net DESC
        {paging}
        """,
        params,
    ).fetchall()
    conn.close()
    out = []
    for r in rows:
        d = dict(r)
        if d.get("label") is None:
            d["label"] = d["grp"]
        # %s use EFFECTIVE sales (returned revenue reversed).
        d["gross_pct"] = d["gross"] / d["sales"] if d["sales"] else 0
        d["net_pct"] = d["net"] / d["sales"] if d["sales"] else 0
        out.append(d)
    return {"group_by": key, "rows": out}


@app.get("/orders")
@cache_response
def list_orders(limit: int = 10, offset: int = 0, segment: str | None = None):
    cols = """[Row ID] AS row_id, [Order ID] AS order_id, Segment AS segment,
              Category AS category, Sales AS sales_original, sales_effective,
              cogs_original, cogs AS cogs_effective, [Shipping Cost] AS shipping,
              allocated_support, return_cost, gross_margin, gross_pct,
              net_margin, net_pct, is_returned"""
    conn = get_connection()
    if segment:
        rows = conn.execute(
            f"SELECT {cols} FROM order_margins WHERE Segment = ? "
            "ORDER BY [Row ID] LIMIT ? OFFSET ?",
            (segment, limit, offset),
        ).fetchall()
    else:
        rows = conn.execute(
            f"SELECT {cols} FROM order_margins ORDER BY [Row ID] LIMIT ? OFFSET ?",
            (limit, offset),
        ).fetchall()
    conn.close()
    return {"orders": [dict(r) for r in rows]}


@app.get("/orders/by-id/{order_id}")
@cache_response
def order_detail(order_id: str):
    conn = get_connection()
    rows = conn.execute(
        """SELECT [Row ID] AS row_id, [Order ID] AS order_id, Segment AS segment,
                  Category AS category, [Sub-Category] AS sub_category, Sales AS sales_original,
                  sales_effective, Quantity AS quantity, Discount AS discount,
                  Profit AS native_profit, cogs_original, cogs AS cogs_effective,
                  [Shipping Cost] AS shipping, allocated_support, return_cost,
                  gross_margin, gross_pct, net_margin, net_pct, is_returned
           FROM order_margins WHERE [Order ID] = ?""",
        (order_id,),
    ).fetchall()
    conn.close()
    if not rows:
        raise HTTPException(404, "Order ID not found")
    return {"order_id": order_id, "lines": [dict(r) for r in rows]}


# ---------------- Phase 2: cost-to-serve, cohorts, pricing ----------------

@cache_response
def _entity_rows(dimension: str) -> list[dict]:
    """Aggregate every entity of a dimension (no paging; used by cohorts/loss-makers)."""
    id_col, label_col = DIMENSIONS[dimension]
    label_sql = f"MAX({label_col}) AS label," if label_col else ""
    conn = get_connection()
    rows = conn.execute(
        f"""
        SELECT {id_col} AS eid,
               {label_sql}
               COUNT(*) AS n_lines,
               SUM(is_returned) AS n_returned_lines,
               SUM(Quantity) AS qty,
               SUM(sales_effective) AS revenue,
               SUM(Sales) AS revenue_original,
               SUM(cogs) AS cogs,
               SUM(gross_margin) AS gross,
               SUM([Shipping Cost]) AS shipping,
               SUM(allocated_support) AS support,
               SUM(return_cost) AS return_cost,
               SUM(net_margin) AS net,
               AVG(Discount) AS avg_discount
        FROM order_margins
        GROUP BY {id_col}
        """
    ).fetchall()
    conn.close()
    out = []
    for r in rows:
        d = dict(r)
        if d.get("label") is None:
            d["label"] = d["eid"]
        c, c_pct = contribution(d["revenue"], d["cogs"], d["shipping"])
        d["contribution"] = c
        d["contribution_pct"] = c_pct
        d["cost_to_serve"] = d["shipping"] + d["support"] + d["return_cost"]
        d["net_pct"] = d["net"] / d["revenue"] if d["revenue"] else 0.0
        d["gross_pct"] = d["gross"] / d["revenue"] if d["revenue"] else 0.0
        out.append(d)
    return out


def _enrich_entity(d: dict) -> dict:
    """Attach status badge + root-cause tags (D11/D12, quartile-derived cutoffs)."""
    d = dict(d)
    d["status_badge"] = status_badge(d["net_pct"], BADGE_CRITICAL_BELOW, BADGE_MODERATE_BELOW)
    cts = d["shipping"] + d["support"] + d["return_cost"]
    freight_share = (d["shipping"] / cts) if cts else 0.0
    return_rate = (d["n_returned_lines"] / d["n_lines"]) if d["n_lines"] else 0.0
    d["avg_discount"] = d.get("avg_discount") or 0.0
    d["return_rate"] = return_rate
    d["freight_share"] = freight_share
    d["tags"] = entity_tags(
        d["avg_discount"], return_rate, freight_share,
        TAG_HIGH_DISCOUNT_ABOVE, TAG_EXCESS_RETURNS_ABOVE, TAG_LOGISTICS_SURGE_ABOVE,
    )
    return d


@app.get("/phase2-assumptions")
def phase2_assumptions():
    return {"assumptions": get_phase2_assumptions()}


@app.get("/cost-to-serve")
@cache_response
def cost_to_serve(
    dimension: str = Query(..., description="customer|product"),
    limit: int = 1000,
    offset: int = 0,
):
    dim = dimension.lower()
    if dim not in ("customer", "product"):
        raise HTTPException(400, "dimension must be customer|product")
    ents = _entity_rows(dim)
    med_rev = median([e["revenue"] for e in ents])
    med_pct = median([e["net_pct"] for e in ents])
    for e in ents:
        e["cohort"] = cohort_label(e["revenue"], e["net_pct"], med_rev, med_pct)
        e["cohort_display"] = COHORT_DISPLAY[e["cohort"]]
        enriched = _enrich_entity(e)
        e["status_badge"] = enriched["status_badge"]
        e["tags"] = enriched["tags"]
        e["avg_discount"] = enriched["avg_discount"]
        e["return_rate"] = enriched["return_rate"]
        e["freight_share"] = enriched["freight_share"]
    ents.sort(key=lambda e: e["net"], reverse=True)
    counts: dict[str, int] = {}
    for e in ents:
        counts[e["cohort"]] = counts.get(e["cohort"], 0) + 1
    return {
        "dimension": dim,
        "median_revenue": med_rev,
        "median_net_pct": med_pct,
        "n_entities": len(ents),
        "cohort_counts": counts,
        "cohort_display": COHORT_DISPLAY,
        "badge_cutoffs": {
            "critical_below": BADGE_CRITICAL_BELOW,
            "moderate_below": BADGE_MODERATE_BELOW,
        },
        "tag_thresholds": {
            "high_discount_above": TAG_HIGH_DISCOUNT_ABOVE,
            "excess_returns_above": TAG_EXCESS_RETURNS_ABOVE,
            "logistics_surge_above": TAG_LOGISTICS_SURGE_ABOVE,
        },
        "rows": ents[offset : offset + limit],
    }


@app.get("/loss-makers")
@cache_response
def loss_makers(
    dimension: str = Query(..., description="product|customer|region"),
    threshold: float = 0.0,
    limit: int = 200,
):
    dim = dimension.lower()
    if dim not in ("product", "customer", "region"):
        raise HTTPException(400, "dimension must be product|customer|region")
    ents = [e for e in _entity_rows(dim) if e["net"] < threshold]
    ents.sort(key=lambda e: e["net"])
    out = []
    for e in ents[:limit]:
        drv = cost_driver(e["shipping"], e["support"], e["return_cost"])
        e = _enrich_entity(e)
        e["driver"] = drv["driver"]
        e["driver_share"] = drv["driver_share"]
        out.append(e)
    return {"dimension": dim, "threshold": threshold, "n_loss_makers": len(ents), "rows": out}


@app.get("/discount-impact")
@cache_response
def discount_impact(group_by: str = Query(..., description="segment|category")):
    key = group_by.lower()
    if key not in ("segment", "category"):
        raise HTTPException(400, "group_by must be segment|category")
    col = "Segment" if key == "segment" else "Category"
    conn = get_connection()
    groups = conn.execute(
        f"""
        SELECT {col} AS grp,
               COUNT(*) AS n_lines,
               AVG(Discount) AS avg_discount_pct,
               SUM(sales_effective) AS revenue,
               SUM(sales_effective - cogs - [Shipping Cost]) AS contribution,
               SUM(net_margin) AS net
        FROM order_margins
        GROUP BY {col}
        ORDER BY grp
        """
    ).fetchall()
    out = []
    for g in groups:
        d = dict(g)
        d["contribution_pct"] = d["contribution"] / d["revenue"] if d["revenue"] else 0.0
        d["net_pct"] = d["net"] / d["revenue"] if d["revenue"] else 0.0
        # Implied discount value recovered for context only (B7); never re-enters margins.
        d["implied_discount_value"] = conn.execute(
            f"""SELECT SUM(CASE WHEN Discount < 1 THEN Sales * Discount / (1 - Discount) ELSE 0 END)
                FROM order_margins WHERE {col} = ?""",
            (d["grp"],),
        ).fetchone()[0]
        pts = conn.execute(
            f"""SELECT Discount,
                       CASE WHEN sales_effective > 0
                            THEN (sales_effective - cogs - [Shipping Cost]) / sales_effective
                            ELSE NULL END AS cp
                FROM order_margins WHERE {col} = ? AND sales_effective > 0""",
            (d["grp"],),
        ).fetchall()
        xs = [r[0] for r in pts]
        ys = [r[1] for r in pts]
        d["correlation_discount_vs_contribution_pct"] = pearson(xs, ys)
        d["correlation_n"] = len(xs)
        out.append(d)
    conn.close()
    return {
        "group_by": key,
        "rows": out,
        "interpretation_note": (
            "The discount/contribution correlation (~-0.84) is a MECHANICAL byproduct of the "
            "formula — discount lowers effective sales while unit COGS is fixed — not an empirical "
            "finding. Use the elasticity-lite band table (volume flat, contribution collapsing) as the "
            "headline evidence for pricing actions, never the raw correlation. See B5."
        ),
    }


@app.get("/elasticity")
@cache_response
def elasticity(group_by: str = Query(..., description="category|segment")):
    key = group_by.lower()
    if key not in ("category", "segment"):
        raise HTTPException(400, "group_by must be category|segment")
    col = "Category" if key == "category" else "Segment"
    conn = get_connection()
    rows = conn.execute(
        f"""
        SELECT {col} AS grp,
               {BAND_CASE_SQL} AS band,
               COUNT(*) AS n_lines,
               AVG(Quantity) AS avg_qty,
               AVG(Discount) AS avg_discount,
               SUM(sales_effective) AS revenue,
               SUM(sales_effective - cogs - [Shipping Cost]) AS contribution,
               SUM(net_margin) AS net
        FROM order_margins
        GROUP BY {col}, band
        """
    ).fetchall()
    conn.close()
    order = {b: i for i, b in enumerate(BAND_ORDER)}
    out = []
    for r in rows:
        d = dict(r)
        d["contribution_pct"] = d["contribution"] / d["revenue"] if d["revenue"] else 0.0
        d["net_pct"] = d["net"] / d["revenue"] if d["revenue"] else 0.0
        out.append(d)
    out.sort(key=lambda d: (d["grp"], order[d["band"]]))
    return {"group_by": key, "bands": list(BAND_ORDER), "rows": out}


@app.post("/simulate")
def simulate(payload: dict):
    try:
        dimension = str(payload["dimension"]).lower()
        entity_id = str(payload["entity_id"])
        d1 = float(payload["new_discount_pct"])
        price_adj = float(payload.get("price_adj", 0.0))
        cogs_red = float(payload.get("cogs_red", 0.0))
        ship_cut = float(payload.get("ship_cut", 0.0))
        vol_override = float(payload.get("vol_override", 1.0))
    except (KeyError, TypeError, ValueError):
        raise HTTPException(400, "Body must be {dimension, entity_id, new_discount_pct}")
    if dimension not in SIMULATABLE:
        raise HTTPException(400, f"dimension must be one of {sorted(SIMULATABLE)}")
    if not (0.0 <= d1 <= 0.90):
        raise HTTPException(400, "new_discount_pct must be within [0, 0.90]")
    if not (-0.90 <= price_adj <= 2.00):
        raise HTTPException(400, "price_adj must be within [-0.90, 2.00]")
    if not (-0.10 <= cogs_red <= 0.90):
        raise HTTPException(400, "cogs_red must be within [-0.10, 0.90]")
    if not (-0.10 <= ship_cut <= 0.90):
        raise HTTPException(400, "ship_cut must be within [-0.10, 0.90]")
    if not (0.10 <= vol_override <= 5.00):
        raise HTTPException(400, "vol_override must be within [0.10, 5.00]")
    id_col, _ = DIMENSIONS[dimension]
    conn = get_connection()
    base = conn.execute(
        f"""SELECT COUNT(*) AS n, SUM(Quantity) AS qty, SUM(sales_effective) AS sales,
                    SUM(cogs) AS cogs, SUM([Shipping Cost]) AS ship, AVG(Discount) AS avg_d
             FROM order_margins WHERE {id_col} = ? AND is_returned = 0""",
        (entity_id,),
    ).fetchone()
    seg_row = conn.execute(
        f"""SELECT Segment AS s, COUNT(*) AS c FROM order_margins
             WHERE {id_col} = ? GROUP BY Segment ORDER BY c DESC LIMIT 1""",
        (entity_id,),
    ).fetchone()
    conn.close()
    if base is None or (base["n"] or 0) == 0:
        raise HTTPException(404, "Entity not found or has no non-returned lines")
    lookup_segment = seg_row["s"] if seg_row else None
    conn2 = get_connection()
    band_rows = conn2.execute(
        f"""SELECT {BAND_CASE_SQL} AS band, AVG(Quantity) AS aq
             FROM order_margins WHERE Segment = ? GROUP BY band""",
        (lookup_segment,),
    ).fetchall()
    conn2.close()
    band_qty = {r[0]: r[1] for r in band_rows}
    d0 = base["avg_d"] or 0.0
    proj = simulate_math(
        qty0=base["qty"] or 0.0,
        sales0=base["sales"] or 0.0,
        cogs0=base["cogs"] or 0.0,
        ship0=base["ship"] or 0.0,
        d0=d0,
        d1=d1,
        band_qty_current=band_qty.get(discount_band(d0)),
        band_qty_new=band_qty.get(discount_band(d1)),
        price_adj=price_adj,
        cogs_red=cogs_red,
        ship_cut=ship_cut,
        vol_override=vol_override,
    )
    scenario_bits = []
    if price_adj:
        scenario_bits.append(f"price {price_adj:+.0%}")
    if cogs_red:
        scenario_bits.append(f"COGS -{cogs_red:.0%}")
    if ship_cut:
        scenario_bits.append(f"shipping -{ship_cut:.0%}")
    if vol_override != 1.0:
        scenario_bits.append(f"volume x{vol_override:.2f} manual override")
    scenario_txt = (" Scenario: " + ", ".join(scenario_bits) + ".") if scenario_bits else ""
    note = (
        f"Elasticity-lite planning aid, not a forecast. Baseline = {base['n']} non-returned "
        f"line(s) of {dimension} '{entity_id}' at mean discount {d0:.2%}. Volume response uses "
        f"segment '{lookup_segment}' band avg-quantity ratio "
        f"({discount_band(d0)} -> {discount_band(d1)}"
        f"{'; fallback ratio 1.0, band data missing' if proj['volume_fallback'] else ''}). "
        f"Unit net price scales by (1-new)/(1-current); unit COGS and unit shipping held constant. "
        f"Returned lines excluded; support/return fees excluded from contribution (see B1/B6).{scenario_txt}"
    )
    return {
        "dimension": dimension,
        "entity_id": entity_id,
        "lookup_segment": lookup_segment,
        "current_band": discount_band(d0),
        "new_band": discount_band(d1),
        "baseline": {
            "n_lines": base["n"],
            "qty": proj["qty_current"],
            "sales": proj["sales_current"],
            "contribution": proj["contribution_current"],
            "avg_discount_pct": d0,
        },
        "projection": {
            "qty": proj["qty_projected"],
            "sales": proj["sales_projected"],
            "contribution": proj["contribution_projected"],
        },
        "delta": {
            "qty": proj["qty_projected"] - proj["qty_current"],
            "sales": proj["sales_projected"] - proj["sales_current"],
            "contribution": proj["contribution_delta"],
        },
        "ratios": {"price": proj["price_ratio"], "volume": proj["volume_ratio"]},
        "scenario": {
            "price_adj": price_adj,
            "cogs_red": cogs_red,
            "ship_cut": ship_cut,
            "vol_override": vol_override,
        },
        "band_table": band_qty,
        "assumption_note": note,
    }


# ---------------- Monthly variance report (rules-based) ----------------

MONTH_RE = re.compile(r"^(\d{4})-(0[1-9]|1[0-2])$")
MONTH_SQL = "substr([Order Date], 1, 7)"


def _shift_month(yyyymm: str, delta: int) -> str:
    y, m = int(yyyymm[:4]), int(yyyymm[5:7])
    m += delta
    while m < 1:
        m += 12
        y -= 1
    while m > 12:
        m -= 12
        y += 1
    return f"{y:04d}-{m:02d}"


def _month_agg(conn, yyyymm: str) -> dict | None:
    row = conn.execute(
        f"""SELECT COUNT(*) AS n_lines, SUM(is_returned) AS n_returned,
                    SUM(sales_effective) AS revenue, SUM(cogs) AS cogs,
                    SUM(gross_margin) AS gross, SUM([Shipping Cost]) AS shipping,
                    SUM(allocated_support) AS support, SUM(return_cost) AS ret,
                    SUM(net_margin) AS net, AVG(Discount) AS avg_discount,
                    AVG(Quantity) AS avg_qty
             FROM order_margins WHERE {MONTH_SQL} = ?""",
        (yyyymm,),
    ).fetchone()
    d = dict(row)
    if not d["n_lines"]:
        return None
    d["month"] = yyyymm
    d["gross_pct"] = d["gross"] / d["revenue"] if d["revenue"] else 0.0
    d["net_pct"] = d["net"] / d["revenue"] if d["revenue"] else 0.0
    return d


@app.get("/variance")
@cache_response
def variance(month: str | None = Query(None, description="YYYY-MM; default latest month in data")):
    conn = get_connection()
    latest = conn.execute(f"SELECT MAX({MONTH_SQL}) FROM order_margins").fetchone()[0]
    earliest = conn.execute(f"SELECT MIN({MONTH_SQL}) FROM order_margins").fetchone()[0]
    target = month or latest
    if not MONTH_RE.match(target):
        conn.close()
        raise HTTPException(400, "month must be YYYY-MM")
    if target < earliest or target > latest:
        conn.close()
        raise HTTPException(404, f"month outside data range {earliest}..{latest}")
    prev = _shift_month(target, -1)
    if prev < earliest:
        conn.close()
        raise HTTPException(404, f"No previous month available for {target}")
    cur = _month_agg(conn, target)
    prv = _month_agg(conn, prev)
    # Prior-year month (same YYYY-MM minus 12) where inside the data range.
    yoy_month = _shift_month(target, -12)
    prior_year = None
    yoy = None
    if earliest <= yoy_month <= latest:
        py = _month_agg(conn, yoy_month)
        if py is not None:
            prior_year = py
            yoy = {
                "revenue": cur["revenue"] - py["revenue"],
                "net": cur["net"] - py["net"],
                "net_pp": (cur["net_pct"] - py["net_pct"]) * 100,
            }
    cat_moves = conn.execute(
        f"""SELECT Category AS c,
                    SUM(CASE WHEN {MONTH_SQL} = ? THEN net_margin ELSE 0 END)
                    - SUM(CASE WHEN {MONTH_SQL} = ? THEN net_margin ELSE 0 END) AS d
             FROM order_margins GROUP BY Category ORDER BY d""",
        (target, prev),
    ).fetchall()
    conn.close()
    if cur is None or prv is None:
        raise HTTPException(404, "No data for requested month")
    deltas = {
        "revenue": cur["revenue"] - prv["revenue"],
        "net": cur["net"] - prv["net"],
        "net_pp": (cur["net_pct"] - prv["net_pct"]) * 100,
        "gross_pp": (cur["gross_pct"] - prv["gross_pct"]) * 100,
        "discount_pp": (cur["avg_discount"] - prv["avg_discount"]) * 100,
        "qty": cur["avg_qty"] - prv["avg_qty"],
    }
    # Attribute the dollar net change to its components.
    parts = {
        "gross": cur["gross"] - prv["gross"],
        "shipping": -(cur["shipping"] - prv["shipping"]),
        "support": -(cur["support"] - prv["support"]),
        "return": -(cur["ret"] - prv["ret"]),
    }
    ranked = sorted(parts.items(), key=lambda kv: abs(kv[1]), reverse=True)
    top_driver, top_val = ranked[0]
    worst = cat_moves[0]  # most negative category swing
    narrative = build_variance_narrative(
        month=target,
        prev=prev,
        cur_net_pp=cur["net_pct"],
        prev_net_pp=prv["net_pct"],
        cur_disc=cur["avg_discount"],
        prev_disc=prv["avg_discount"],
        cur_qty=cur["avg_qty"],
        prev_qty=prv["avg_qty"],
        top_driver=top_driver,
        top_driver_delta=top_val,
        worst_category=worst[0],
        worst_category_delta=worst[1],
    )
    return {
        "month": target,
        "previous_month": prev,
        "current": cur,
        "previous": prv,
        "prior_year_month": yoy_month if prior_year is not None else None,
        "prior_year": prior_year,
        "year_over_year": yoy,
        "deltas": deltas,
        "drivers": [{"component": k, "delta_net_dollars": v} for k, v in ranked],
        "category_net_swings": [{"category": r[0], "delta_net": r[1]} for r in cat_moves],
        "narrative": narrative,
        "assumption_note": (
            "Rules-based template, not NLG: months are calendar months of Order Date "
            "(unequal day counts not adjusted); returned lines stay reversed per Phase 1; "
            "headline cites the dollar driver plus discount/volume band evidence, never the "
            "mechanical discount/contribution correlation (see B5)."
        ),
    }


# ---------------- UI/UX enhancement: new read-only aggregation endpoints ----------------

@app.get("/ui-assumptions")
def ui_assumptions():
    return {"assumptions": get_ui_assumptions()}


@app.get("/months")
@cache_response
def months():
    conn = get_connection()
    rows = conn.execute(
        f"SELECT DISTINCT {MONTH_SQL} AS m FROM order_margins ORDER BY m"
    ).fetchall()
    conn.close()
    ms = [r[0] for r in rows]
    return {"months": ms, "earliest": ms[0] if ms else None, "latest": ms[-1] if ms else None,
            "n_months": len(ms)}


@app.get("/kpi-trend")
@cache_response
def kpi_trend(months_n: int = 6):
    if not (1 <= months_n <= 48):
        raise HTTPException(400, "months_n must be within [1, 48]")
    conn = get_connection()
    latest = conn.execute(f"SELECT MAX({MONTH_SQL}) FROM order_margins").fetchone()[0]
    earliest = conn.execute(f"SELECT MIN({MONTH_SQL}) FROM order_margins").fetchone()[0]
    # Walk back months_n months from latest (only months present in data).
    want: list[str] = []
    cur = latest
    while len(want) < months_n and cur >= earliest:
        want.append(cur)
        cur = _shift_month(cur, -1)
    want.reverse()
    points = []
    for m in want:
        agg = _month_agg(conn, m)
        if agg is None:
            continue
        points.append({
            "month": m,
            "revenue": agg["revenue"],
            "gross": agg["gross"],
            "net": agg["net"],
            "gross_pct": agg["gross_pct"],
            "net_pct": agg["net_pct"],
            "n_lines": agg["n_lines"],
        })
    conn.close()
    return {"months": want, "points": points,
            "assumption_note": "Calendar months of Order Date; same grouping as /variance (D2)."}


HEATMAP_ROWS = {
    "category": ("Category", None),
    "product": ("[Product ID]", "[Product Name]"),
}
HEATMAP_COLS = {
    "segment": "Segment",
    "region": "Region",
}


@app.get("/margin-heatmap")
@cache_response
def margin_heatmap(
    rows: str = Query("category", description="category|product"),
    cols: str = Query("segment", description="segment|region"),
    limit: int = 50,
    offset: int = 0,
):
    rkey, ckey = rows.lower(), cols.lower()
    if rkey not in HEATMAP_ROWS:
        raise HTTPException(400, "rows must be category|product")
    if ckey not in HEATMAP_COLS:
        raise HTTPException(400, "cols must be segment|region")
    rcol, rlabel = HEATMAP_ROWS[rkey]
    ccol = HEATMAP_COLS[ckey]
    rlabel_sql = f"MAX({rlabel}) AS rlabel," if rlabel else ""
    conn = get_connection()
    q = f"""
        SELECT {rcol} AS r, {ccol} AS c,
               {rlabel_sql}
               COUNT(*) AS n_lines,
               SUM(sales_effective) AS revenue,
               SUM(net_margin) AS net
        FROM order_margins
        GROUP BY {rcol}, {ccol}
        """
    recs = conn.execute(q).fetchall()
    cells = []
    for rec in recs:
        d = dict(rec)
        label = d.get("rlabel") or d["r"]
        rev = d["revenue"] or 0.0
        cells.append({
            "row": d["r"], "row_label": label, "col": d["c"],
            "n_lines": d["n_lines"], "revenue": rev,
            "net": d["net"] or 0.0,
            "net_pct": (d["net"] / rev) if rev else 0.0,
        })
    # Row totals for worst-first paging in product mode.
    totals: dict = {}
    for cl in cells:
        t = totals.setdefault(cl["row"], {"row": cl["row"], "row_label": cl["row_label"],
                                          "net": 0.0, "revenue": 0.0, "n_lines": 0})
        t["net"] += cl["net"]
        t["revenue"] += cl["revenue"]
        t["n_lines"] += cl["n_lines"]
    for t in totals.values():
        t["net_pct"] = (t["net"] / t["revenue"]) if t["revenue"] else 0.0
    ordered_rows = sorted(totals.values(), key=lambda t: t["net"])
    page = ordered_rows[offset: offset + limit] if rkey == "product" else ordered_rows
    keep = {t["row"] for t in page}
    total_net = sum(cl["net"] for cl in cells)
    summary_net = conn.execute("SELECT SUM(net_margin) FROM order_margins").fetchone()[0] or 0.0
    conn.close()
    return {
        "rows_dim": rkey, "cols_dim": ckey,
        "row_totals": page,
        "n_rows_total": len(ordered_rows),
        "cells": [cl for cl in cells if cl["row"] in keep],
        "total_net_cells": total_net,
        "summary_net": summary_net,
        "reconciles": abs(total_net - summary_net) < 0.05,
    }


@app.get("/entity-trend")
@cache_response
def entity_trend(
    dimension: str = Query(..., description="product|customer|region|segment|category"),
    id: str = Query(..., description="Entity id value (e.g. Product ID)"),
):
    dim = dimension.lower()
    if dim not in DIMENSIONS:
        raise HTTPException(400, f"dimension must be one of {sorted(DIMENSIONS)}")
    id_col, _ = DIMENSIONS[dim]
    conn = get_connection()
    months_rows = conn.execute(
        f"""SELECT {MONTH_SQL} AS m, COUNT(*) AS n_lines,
                    SUM(sales_effective) AS revenue, SUM(net_margin) AS net
             FROM order_margins WHERE {id_col} = ?
             GROUP BY m ORDER BY m""",
        (id,),
    ).fetchall()
    conn.close()
    if not months_rows:
        raise HTTPException(404, "Entity not found or has no lines")
    points = []
    for r in months_rows:
        d = dict(r)
        rev = d["revenue"] or 0.0
        points.append({
            "month": d["m"], "n_lines": d["n_lines"],
            "revenue": rev, "net": d["net"] or 0.0,
            "net_pct": ((d["net"] or 0.0) / rev) if rev else 0.0,
        })
    return {"dimension": dim, "entity_id": id, "n_months": len(points), "points": points,
            "assumption_note": "Monthly grouping reuses /variance calendar-month logic, scoped to one entity."}


@app.get("/cost-structure")
@cache_response
def cost_structure():
    """Totals + ship-mode freight split for the donut/Sankey (reconciled to /summary)."""
    conn = get_connection()
    tot = conn.execute(
        """SELECT SUM(sales_effective) AS revenue, SUM(cogs) AS cogs,
                  SUM([Shipping Cost]) AS shipping, SUM(allocated_support) AS support,
                  SUM(return_cost) AS ret, SUM(net_margin) AS net,
                  SUM(gross_margin) AS gross,
                  SUM(CASE WHEN Discount < 1 THEN sales_effective / (1 - Discount) ELSE sales_effective END) AS list_price
           FROM order_margins"""
    ).fetchone()
    by_mode = conn.execute(
        """SELECT [Ship Mode] AS mode, COUNT(*) AS n_lines,
                  SUM(sales_effective) AS revenue, SUM([Shipping Cost]) AS shipping,
                  SUM(net_margin) AS net
           FROM order_margins GROUP BY [Ship Mode] ORDER BY shipping DESC"""
    ).fetchall()
    conn.close()
    d = dict(tot)
    modes = [dict(r) for r in by_mode]
    # Sankey proxy buckets (D10): Standard | First+Second | Same Day.
    freight_by_bucket: dict[str, float] = {"Standard Class": 0.0, "First+Second Class": 0.0, "Same Day": 0.0}
    for m in modes:
        if m["mode"] == "Standard Class":
            freight_by_bucket["Standard Class"] += m["shipping"] or 0.0
        elif m["mode"] in ("First Class", "Second Class"):
            freight_by_bucket["First+Second Class"] += m["shipping"] or 0.0
        elif m["mode"] == "Same Day":
            freight_by_bucket["Same Day"] += m["shipping"] or 0.0
    return {
        "totals": d,
        "by_ship_mode": modes,
        "freight_by_bucket": freight_by_bucket,
        "assumption_note": "Ship Mode is a freight-split proxy, not a literal cost category (D10).",
    }


@app.get("/treemap")
@cache_response
def treemap():
    """Category -> Sub-Category revenue treemap data (D20, reconciled to summary)."""
    conn = get_connection()
    cats = conn.execute(
        """SELECT Category AS name, COUNT(*) AS n_lines,
                  SUM(sales_effective) AS revenue, SUM(net_margin) AS net
           FROM order_margins GROUP BY Category ORDER BY revenue DESC"""
    ).fetchall()
    children = conn.execute(
        """SELECT Category AS parent, [Sub-Category] AS name, COUNT(*) AS n_lines,
                  SUM(sales_effective) AS revenue, SUM(net_margin) AS net
           FROM order_margins GROUP BY Category, [Sub-Category]"""
    ).fetchall()
    summary_net = conn.execute("SELECT SUM(net_margin) FROM order_margins").fetchone()[0] or 0.0
    conn.close()

    def node(name: str, revenue: float, net: float, n_lines: int) -> dict:
        rev = revenue or 0.0
        return {"name": name, "revenue": rev, "net": net or 0.0,
                "net_pct": ((net or 0.0) / rev) if rev else 0.0, "n_lines": n_lines}

    out = []
    for c in cats:
        cd = dict(c)
        kids = [node(r["name"], r["revenue"], r["net"], r["n_lines"])
                for r in children if r["parent"] == cd["name"]]
        kids.sort(key=lambda k: k["revenue"], reverse=True)
        entry = node(cd["name"], cd["revenue"], cd["net"], cd["n_lines"])
        entry["children"] = kids
        out.append(entry)
    total_net = sum(e["net"] for e in out)
    return {"nodes": out, "total_net_cells": total_net, "summary_net": summary_net,
            "reconciles": abs(total_net - summary_net) < 0.05,
            "assumption_note": "Sizes by effective revenue, colors by net margin % (D20)."}


FREQ_BANDS: list[tuple[str, int | None, int | None]] = [
    ("1-2", 1, 2),
    ("3-5", 3, 5),
    ("6-10", 6, 10),
    ("10+", 11, None),
]


def _freq_band(n_lines: int) -> str:
    for label, lo, hi in FREQ_BANDS:
        if n_lines >= lo and (hi is None or n_lines <= hi):
            return label
    return "1-2"


@app.get("/frequency-heatmap")
@cache_response
def frequency_heatmap():
    """Customer order-frequency x cost-tier heatmap (D21, reconciled to summary)."""
    conn = get_connection()
    rows = conn.execute(
        """SELECT [Customer ID] AS eid, COUNT(*) AS n_lines,
                  SUM(sales_effective) AS revenue, SUM(net_margin) AS net,
                  SUM([Shipping Cost]) AS shipping, SUM(allocated_support) AS support,
                  SUM(return_cost) AS ret
           FROM order_margins GROUP BY [Customer ID]"""
    ).fetchall()
    summary_net = conn.execute("SELECT SUM(net_margin) FROM order_margins").fetchone()[0] or 0.0
    conn.close()
    ents = []
    for r in rows:
        d = dict(r)
        cts = (d["shipping"] or 0.0) + (d["support"] or 0.0) + (d["ret"] or 0.0)
        ents.append({"n_lines": d["n_lines"], "revenue": d["revenue"] or 0.0,
                     "net": d["net"] or 0.0, "cost_to_serve": cts})
    costs = sorted(e["cost_to_serve"] for e in ents)
    t1 = costs[len(costs) // 3]
    t2 = costs[2 * len(costs) // 3]

    def tier(c: float) -> str:
        return "Low" if c <= t1 else ("Medium" if c <= t2 else "High")

    cells: dict[tuple[str, str], dict] = {}
    for e in ents:
        key = (_freq_band(e["n_lines"]), tier(e["cost_to_serve"]))
        cell = cells.setdefault(key, {"freq_band": key[0], "tier": key[1],
                                      "n_customers": 0, "revenue": 0.0, "net": 0.0})
        cell["n_customers"] += 1
        cell["revenue"] += e["revenue"]
        cell["net"] += e["net"]
    out = []
    for (fb, t), cell in sorted(cells.items()):
        rev = cell["revenue"]
        cell["avg_net_pct"] = (cell["net"] / rev) if rev else 0.0
        out.append(cell)
    total_net = sum(c["net"] for c in out)
    return {"frequency_bands": [b[0] for b in FREQ_BANDS], "tiers": ["Low", "Medium", "High"],
            "tier_thresholds": {"low_below": t1, "medium_below": t2},
            "cells": out, "n_customers": len(ents),
            "total_net_cells": total_net, "summary_net": summary_net,
            "reconciles": abs(total_net - summary_net) < 0.05,
            "assumption_note": "Frequency = order-line count per customer (D21)."}


@app.get("/drill-tree")
@cache_response
def drill_tree(
    category: str | None = None,
    sub_category: str | None = None,
    limit: int = 50,
):
    """Category -> Sub-Category -> Product drill-down (all-time dollars, reconciled).

    No params: categories. category=X: sub-categories of X.
    category=X&sub_category=Y: worst-first products of Y (paged).
    Children net sums equal the parent net (test-asserted).
    """
    conn = get_connection()
    if category is None:
        rows = conn.execute(
            """SELECT Category AS name, COUNT(*) AS n_lines,
                      SUM(sales_effective) AS revenue, SUM(net_margin) AS net
               FROM order_margins GROUP BY Category ORDER BY net"""
        ).fetchall()
        conn.close()
        out = []
        for r in rows:
            d = dict(r)
            rev = d["revenue"] or 0.0
            out.append({"name": d["name"], "n_lines": d["n_lines"], "revenue": rev,
                        "net": d["net"] or 0.0,
                        "net_pct": ((d["net"] or 0.0) / rev) if rev else 0.0})
        return {"level": "category", "children": out}
    if sub_category is None:
        chk = conn.execute("SELECT COUNT(*) FROM order_margins WHERE Category = ?", (category,)).fetchone()[0]
        if not chk:
            conn.close()
            raise HTTPException(404, "Category not found")
        rows = conn.execute(
            """SELECT [Sub-Category] AS name, COUNT(*) AS n_lines,
                      SUM(sales_effective) AS revenue, SUM(net_margin) AS net
               FROM order_margins WHERE Category = ? GROUP BY [Sub-Category] ORDER BY net""",
            (category,),
        ).fetchall()
        parent_net = conn.execute(
            "SELECT SUM(net_margin) FROM order_margins WHERE Category = ?", (category,)
        ).fetchone()[0] or 0.0
        conn.close()
        out = []
        for r in rows:
            d = dict(r)
            rev = d["revenue"] or 0.0
            net = d["net"] or 0.0
            out.append({"name": d["name"], "n_lines": d["n_lines"], "revenue": rev, "net": net,
                        "net_pct": (net / rev) if rev else 0.0,
                        "share_of_parent": (net / parent_net) if parent_net else 0.0})
        return {"level": "sub_category", "parent": category, "parent_net": parent_net, "children": out}
    chk = conn.execute(
        "SELECT COUNT(*) FROM order_margins WHERE Category = ? AND [Sub-Category] = ?",
        (category, sub_category),
    ).fetchone()[0]
    if not chk:
        conn.close()
        raise HTTPException(404, "Sub-category not found in category")
    total = conn.execute(
        "SELECT COUNT(DISTINCT [Product ID]) FROM order_margins WHERE Category = ? AND [Sub-Category] = ?",
        (category, sub_category),
    ).fetchone()[0]
    rows = conn.execute(
        """SELECT [Product ID] AS pid, MAX([Product Name]) AS label, COUNT(*) AS n_lines,
                  SUM(sales_effective) AS revenue, SUM(net_margin) AS net
           FROM order_margins WHERE Category = ? AND [Sub-Category] = ?
           GROUP BY [Product ID] ORDER BY net LIMIT ?""",
        (category, sub_category, limit),
    ).fetchall()
    parent_net = conn.execute(
        "SELECT SUM(net_margin) FROM order_margins WHERE Category = ? AND [Sub-Category] = ?",
        (category, sub_category),
    ).fetchone()[0] or 0.0
    conn.close()
    out = []
    for r in rows:
        d = dict(r)
        rev = d["revenue"] or 0.0
        net = d["net"] or 0.0
        out.append({"pid": d["pid"], "label": d["label"] or d["pid"], "n_lines": d["n_lines"],
                    "revenue": rev, "net": net,
                    "net_pct": (net / rev) if rev else 0.0,
                    "share_of_parent": (net / parent_net) if parent_net else 0.0})
    return {"level": "product", "parent": f"{category} / {sub_category}", "parent_net": parent_net,
            "n_products_total": total, "children": out}


# ---------------- Flags (persisted review queue, D13) ----------------
@app.post("/flags")
def create_flag(payload: dict):
    try:
        entity_type = str(payload["entity_type"]).lower()
        entity_id = str(payload["entity_id"])
        status = str(payload.get("status", "open")).lower()
        note = str(payload.get("note", ""))
    except (KeyError, TypeError, ValueError, AttributeError):
        raise HTTPException(400, "Body must be {entity_type, entity_id, status?, note?}")
    if entity_type not in FLAG_ENTITY_TYPES:
        raise HTTPException(400, f"entity_type must be one of {list(FLAG_ENTITY_TYPES)}")
    if status not in FLAG_STATUSES:
        raise HTTPException(400, f"status must be one of {list(FLAG_STATUSES)}")
    conn = get_connection()
    _ensure_flags_table(conn)
    cur = conn.execute(
        "INSERT INTO flags (entity_type, entity_id, status, note, flagged_at) "
        "VALUES (?, ?, ?, ?, datetime('now'))",
        (entity_type, entity_id, status, note),
    )
    fid = cur.lastrowid
    conn.commit()
    row = conn.execute("SELECT * FROM flags WHERE id = ?", (fid,)).fetchone()
    conn.close()
    return dict(row)


@app.get("/flags")
def list_flags(
    entity_type: str | None = None,
    entity_id: str | None = None,
    status: str | None = None,
):
    conn = get_connection()
    _ensure_flags_table(conn)
    q = "SELECT * FROM flags WHERE 1=1"
    params: list = []
    if entity_type:
        q += " AND entity_type = ?"
        params.append(entity_type.lower())
    if entity_id:
        q += " AND entity_id = ?"
        params.append(entity_id)
    if status:
        if status.lower() not in FLAG_STATUSES:
            conn.close()
            raise HTTPException(400, f"status must be one of {list(FLAG_STATUSES)}")
        q += " AND status = ?"
        params.append(status.lower())
    q += " ORDER BY id DESC"
    rows = conn.execute(q, tuple(params)).fetchall()
    conn.close()
    return {"n_flags": len(rows), "flags": [dict(r) for r in rows]}


@app.patch("/flags/{flag_id}")
def update_flag(flag_id: int, payload: dict):
    if not isinstance(payload, dict):
        raise HTTPException(400, "Body must be {status?, note?}")
    status = payload.get("status")
    note = payload.get("note")
    if status is not None and str(status).lower() not in FLAG_STATUSES:
        raise HTTPException(400, f"status must be one of {list(FLAG_STATUSES)}")
    if status is None and note is None:
        raise HTTPException(400, "Nothing to update (status?, note?)")
    conn = get_connection()
    _ensure_flags_table(conn)
    row = conn.execute("SELECT * FROM flags WHERE id = ?", (flag_id,)).fetchone()
    if row is None:
        conn.close()
        raise HTTPException(404, "Flag not found")
    if status is not None:
        conn.execute("UPDATE flags SET status = ? WHERE id = ?", (str(status).lower(), flag_id))
    if note is not None:
        conn.execute("UPDATE flags SET note = ? WHERE id = ?", (str(note), flag_id))
    conn.commit()
    row = conn.execute("SELECT * FROM flags WHERE id = ?", (flag_id,)).fetchone()
    conn.close()
    return dict(row)
