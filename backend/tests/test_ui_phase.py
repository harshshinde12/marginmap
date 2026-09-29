"""UI/UX enhancement backend tests — new endpoints + badge/tag wiring + reconciliation."""
from __future__ import annotations

import sqlite3

from fastapi.testclient import TestClient

from app.config import (
    BADGE_CRITICAL_BELOW,
    BADGE_MODERATE_BELOW,
    COHORT_DISPLAY,
    TAG_EXCESS_RETURNS_ABOVE,
    TAG_HIGH_DISCOUNT_ABOVE,
    TAG_LOGISTICS_SURGE_ABOVE,
)
from app.database import DB_PATH, get_connection
from app.main import app
from app.phase2 import entity_tags, status_badge

client = TestClient(app)


def test_ui_assumptions_lists_d1_through_d19():
    body = client.get("/ui-assumptions").json()
    ass = body["assumptions"]
    assert len(ass) >= 19
    for prefix in [f"D{i}" for i in range(1, 20)]:
        assert any(a.startswith(prefix) for a in ass), prefix
    # palette + USD-only + no-email rules are documented
    text = "\n".join(ass)
    assert "#10B981" in text and "#EF4444" in text
    assert "No email is sent" in text
    assert "USD" in text


def test_months_lists_real_calendar_months():
    body = client.get("/months").json()
    assert body["n_months"] == 48
    assert body["earliest"] == "2011-01" and body["latest"] == "2014-12"
    assert body["months"][0] == "2011-01" and body["months"][-1] == "2014-12"
    assert len(set(body["months"])) == 48


def test_kpi_trend_last6_and_full_reconciliation():
    body = client.get("/kpi-trend", params={"months_n": 6}).json()
    assert len(body["points"]) == 6
    assert body["points"][-1]["month"] == "2014-12"
    for p in body["points"]:
        assert set(p) >= {"month", "revenue", "gross", "net", "gross_pct", "net_pct", "n_lines"}
    # full 48-month walk sums to the Phase 1 summary (same grouping as /variance)
    full = client.get("/kpi-trend", params={"months_n": 48}).json()
    assert len(full["points"]) == 48
    summary = client.get("/summary").json()
    assert abs(sum(p["revenue"] for p in full["points"]) - summary["total_effective_sales"]) < 0.05
    assert abs(sum(p["net"] for p in full["points"]) - summary["total_net"]) < 0.05
    assert abs(sum(p["gross"] for p in full["points"]) - summary["total_gross"]) < 0.05
    assert client.get("/kpi-trend", params={"months_n": 0}).status_code == 400
    assert client.get("/kpi-trend", params={"months_n": 49}).status_code == 400


def test_heatmap_reconciles_and_product_pages_worst_first():
    body = client.get("/margin-heatmap", params={"rows": "category", "cols": "segment"}).json()
    assert body["reconciles"] is True
    assert abs(body["total_net_cells"] - body["summary_net"]) < 0.05
    summary = client.get("/summary").json()
    assert abs(body["summary_net"] - summary["total_net"]) < 0.05
    # every cell carries net_pct consistent with its dollars
    for c in body["cells"][:20]:
        rev = c["revenue"]
        assert abs(c["net_pct"] - (c["net"] / rev if rev else 0.0)) < 1e-9
    # product mode: row totals sorted worst-first, paging works
    p1 = client.get("/margin-heatmap", params={"rows": "product", "cols": "region", "limit": 10, "offset": 0}).json()
    assert p1["reconciles"] is True
    nets = [t["net"] for t in p1["row_totals"]]
    assert nets == sorted(nets)
    assert len(p1["row_totals"]) == 10
    p2 = client.get("/margin-heatmap", params={"rows": "product", "cols": "region", "limit": 10, "offset": 10}).json()
    assert [t["row"] for t in p2["row_totals"]] != [t["row"] for t in p1["row_totals"]]
    assert client.get("/margin-heatmap", params={"rows": "planet", "cols": "segment"}).status_code == 400
    assert client.get("/margin-heatmap", params={"rows": "category", "cols": "planet"}).status_code == 400


def test_entity_trend_scopes_one_entity_and_404s():
    # known product from the simulator default
    body = client.get("/entity-trend", params={"dimension": "product", "id": "TEC-MA-10000418"}).json()
    assert body["dimension"] == "product" and body["n_months"] >= 1
    months = [p["month"] for p in body["points"]]
    assert months == sorted(months)
    # sums reconcile to the entity aggregate
    conn = sqlite3.connect(str(DB_PATH))
    try:
        row = conn.execute(
            "SELECT SUM(sales_effective), SUM(net_margin) FROM order_margins WHERE [Product ID] = ?",
            ("TEC-MA-10000418",),
        ).fetchone()
    finally:
        conn.close()
    assert abs(sum(p["revenue"] for p in body["points"]) - row[0]) < 0.01
    assert abs(sum(p["net"] for p in body["points"]) - row[1]) < 0.01
    assert client.get("/entity-trend", params={"dimension": "product", "id": "NO-SUCH-ID"}).status_code == 404
    assert client.get("/entity-trend", params={"dimension": "planet", "id": "x"}).status_code == 400


def test_cost_structure_reconciles_and_buckets_sum():
    body = client.get("/cost-structure").json()
    summary = client.get("/summary").json()
    t = body["totals"]
    assert abs(t["revenue"] - summary["total_effective_sales"]) < 0.05
    assert abs(t["net"] - summary["total_net"]) < 0.05
    assert abs(t["shipping"] - summary["total_shipping"]) < 0.05
    assert abs(t["support"] - summary["total_support"]) < 0.05
    assert abs(t["ret"] - summary["total_return_cost"]) < 0.01
    # net identity holds on totals: net = gross - shipping - support - ret
    assert abs(t["net"] - (t["gross"] - t["shipping"] - t["support"] - t["ret"])) < 0.05
    # freight buckets partition shipping exactly (D10 proxy)
    assert abs(sum(body["freight_by_bucket"].values()) - t["shipping"]) < 0.01
    assert set(body["freight_by_bucket"]) == {"Standard Class", "First+Second Class", "Same Day"}
    assert abs(sum(m["shipping"] for m in body["by_ship_mode"]) - t["shipping"]) < 0.01


def test_variance_prior_year_present_and_null_at_edges():
    full = client.get("/variance", params={"month": "2014-12"}).json()
    assert full["prior_year_month"] == "2013-12"
    assert full["prior_year"] is not None and full["year_over_year"] is not None
    assert abs(full["year_over_year"]["net"] - (full["current"]["net"] - full["prior_year"]["net"])) < 0.01
    # backward compat: old fields unchanged
    assert full["month"] == "2014-12" and full["previous_month"] == "2014-11"
    assert "deltas" in full and "drivers" in full and "narrative" in full
    # first 12 months have no prior year in range
    early = client.get("/variance", params={"month": "2011-06"}).json()
    assert early["prior_year"] is None and early["year_over_year"] is None
    assert early["prior_year_month"] is None


def test_badges_tags_wired_into_cost_to_serve_and_loss_makers():
    body = client.get("/cost-to-serve", params={"dimension": "product", "limit": 50}).json()
    assert body["badge_cutoffs"] == {"critical_below": BADGE_CRITICAL_BELOW, "moderate_below": BADGE_MODERATE_BELOW}
    assert body["tag_thresholds"] == {
        "high_discount_above": TAG_HIGH_DISCOUNT_ABOVE,
        "excess_returns_above": TAG_EXCESS_RETURNS_ABOVE,
        "logistics_surge_above": TAG_LOGISTICS_SURGE_ABOVE,
    }
    assert body["cohort_display"] == COHORT_DISPLAY
    allowed_badges = {"Critical", "Moderate", "Warning", "Healthy"}
    allowed_keys = {"high_discount", "excess_returns", "logistics_surge"}
    for r in body["rows"]:
        assert r["cohort_display"] == COHORT_DISPLAY[r["cohort"]]
        assert r["status_badge"] in allowed_badges
        assert r["status_badge"] == status_badge(r["net_pct"], BADGE_CRITICAL_BELOW, BADGE_MODERATE_BELOW)
        assert r["tags"] == entity_tags(
            r["avg_discount"], r["return_rate"], r["freight_share"],
            TAG_HIGH_DISCOUNT_ABOVE, TAG_EXCESS_RETURNS_ABOVE, TAG_LOGISTICS_SURGE_ABOVE,
        )
        assert all(t["key"] in allowed_keys for t in r["tags"])
    loss = client.get("/loss-makers", params={"dimension": "product", "limit": 20}).json()
    for r in loss["rows"]:
        assert r["status_badge"] in allowed_badges
        assert isinstance(r["tags"], list)
        assert r["driver"] in ("freight", "support", "returns", None)


def test_simulate_scenario_sliders_extend_defaults():
    base = client.post(
        "/simulate",
        json={"dimension": "product", "entity_id": "TEC-MA-10000418", "new_discount_pct": 0.10},
    ).json()
    assert base["scenario"] == {"price_adj": 0.0, "cogs_red": 0.0, "ship_cut": 0.0, "vol_override": 1.0}
    # price lift must raise projected contribution vs baseline-slider run
    lifted = client.post(
        "/simulate",
        json={"dimension": "product", "entity_id": "TEC-MA-10000418",
              "new_discount_pct": 0.10, "price_adj": 0.10},
    ).json()
    assert lifted["projection"]["contribution"] > base["projection"]["contribution"]
    assert lifted["scenario"]["price_adj"] == 0.10
    # volume override scales quantity
    vol2 = client.post(
        "/simulate",
        json={"dimension": "product", "entity_id": "TEC-MA-10000418",
              "new_discount_pct": 0.10, "vol_override": 2.0},
    ).json()
    assert abs(vol2["projection"]["qty"] - 2.0 * base["projection"]["qty"]) < 1e-6
    # validation (COGS/shipping accept down to -0.10 for sensitivity use, D22)
    for bad in [{"price_adj": 5.0}, {"cogs_red": -0.11}, {"ship_cut": 0.99 + 0.01},
                {"vol_override": 0.05}, {"vol_override": 9.0}]:
        payload = {"dimension": "product", "entity_id": "TEC-MA-10000418", "new_discount_pct": 0.10}
        payload.update(bad)
        assert client.post("/simulate", json=payload).status_code == 400, bad


def test_flags_crud_and_validation():
    eid = "TEST-FLAG-PROBE-001"
    # cleanup any leftovers from a prior interrupted run
    conn = get_connection()
    try:
        conn.execute("CREATE TABLE IF NOT EXISTS flags (id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', note TEXT NOT NULL DEFAULT '', flagged_at TEXT NOT NULL DEFAULT (datetime('now')))")
        conn.execute("DELETE FROM flags WHERE entity_id = ?", (eid,))
        conn.commit()
    finally:
        conn.close()
    try:
        created = client.post("/flags", json={"entity_type": "product", "entity_id": eid, "note": "probe"}).json()
        assert created["entity_type"] == "product" and created["entity_id"] == eid
        assert created["status"] == "open" and created["note"] == "probe"
        fid = created["id"]
        listed = client.get("/flags", params={"entity_id": eid}).json()
        assert listed["n_flags"] >= 1
        assert any(f["id"] == fid for f in listed["flags"])
        patched = client.patch(f"/flags/{fid}", json={"status": "resolved"}).json()
        assert patched["status"] == "resolved"
        by_status = client.get("/flags", params={"status": "resolved", "entity_id": eid}).json()
        assert any(f["id"] == fid for f in by_status["flags"])
        # validation
        assert client.post("/flags", json={"entity_type": "planet", "entity_id": eid}).status_code == 400
        assert client.post("/flags", json={"entity_type": "product", "entity_id": eid, "status": "bogus"}).status_code == 400
        assert client.post("/flags", json={"entity_type": "product"}).status_code == 400
        assert client.patch(f"/flags/{fid}", json={"status": "bogus"}).status_code == 400
        assert client.patch("/flags/999999999", json={"status": "open"}).status_code == 404
        assert client.patch(f"/flags/{fid}", json={}).status_code == 400
    finally:
        conn = get_connection()
        try:
            conn.execute("DELETE FROM flags WHERE entity_id = ?", (eid,))
            conn.commit()
        finally:
            conn.close()


def test_drill_tree_levels_reconcile():
    cats = client.get("/drill-tree").json()
    assert cats["level"] == "category" and len(cats["children"]) == 3
    summary = client.get("/summary").json()
    assert abs(sum(c["net"] for c in cats["children"]) - summary["total_net"]) < 0.05
    for c in cats["children"]:
        subs = client.get("/drill-tree", params={"category": c["name"]}).json()
        assert subs["level"] == "sub_category"
        assert abs(sum(s["net"] for s in subs["children"]) - c["net"]) < 0.01
        first = subs["children"][0]
        prods = client.get(
            "/drill-tree",
            params={"category": c["name"], "sub_category": first["name"], "limit": 100000},
        ).json()
        assert prods["level"] == "product"
        assert abs(sum(p["net"] for p in prods["children"]) - first["net"]) < 0.01
        assert abs(sum(p["net"] for p in prods["children"]) - prods["parent_net"]) < 0.01
    assert client.get("/drill-tree", params={"category": "Nope"}).status_code == 404
    assert client.get("/drill-tree", params={"category": "Furniture", "sub_category": "Nope"}).status_code == 404


def test_treemap_reconciles_and_nests():
    body = client.get("/treemap").json()
    assert body["reconciles"] is True
    assert len(body["nodes"]) == 3
    summary = client.get("/summary").json()
    assert abs(body["summary_net"] - summary["total_net"]) < 0.05
    assert abs(body["total_net_cells"] - summary["total_net"]) < 0.05
    # children partition the parent, pct math consistent
    for node in body["nodes"]:
        kids = node["children"]
        assert len(kids) > 0
        assert abs(sum(k["net"] for k in kids) - node["net"]) < 0.01
        assert abs(sum(k["revenue"] for k in kids) - node["revenue"]) < 0.01
        for k in kids:
            rev = k["revenue"]
            assert abs(k["net_pct"] - (k["net"] / rev if rev else 0.0)) < 1e-9


def test_frequency_heatmap_covers_all_customers_and_reconciles():
    body = client.get("/frequency-heatmap").json()
    assert body["frequency_bands"] == ["1-2", "3-5", "6-10", "10+"]
    assert body["tiers"] == ["Low", "Medium", "High"]
    assert body["n_customers"] == 1590
    assert body["tier_thresholds"]["low_below"] <= body["tier_thresholds"]["medium_below"]
    assert sum(c["n_customers"] for c in body["cells"]) == 1590
    assert body["reconciles"] is True
    summary = client.get("/summary").json()
    assert abs(body["summary_net"] - summary["total_net"]) < 0.05
    for c in body["cells"]:
        rev = c["revenue"]
        assert abs(c["avg_net_pct"] - (c["net"] / rev if rev else 0.0)) < 1e-9


def test_simulate_sensitivity_bounds():
    base = {"dimension": "product", "entity_id": "TEC-MA-10000418", "new_discount_pct": 0.10}
    # widened floor for tornado use (D22): small cost increases accepted
    for ok in [{"cogs_red": -0.10}, {"ship_cut": -0.10}, {"cogs_red": -0.01, "ship_cut": -0.01}]:
        payload = dict(base)
        payload.update(ok)
        r = client.post("/simulate", json=payload)
        assert r.status_code == 200, ok
        assert r.json()["scenario"]["cogs_red"] == ok.get("cogs_red", 0.0)
    # just past the floor still rejected
    for bad in [{"cogs_red": -0.11}, {"ship_cut": -0.11}]:
        payload = dict(base)
        payload.update(bad)
        assert client.post("/simulate", json=payload).status_code == 400, bad
    # price shifts move contribution monotonically (discount change dominates level,
    # so both deltas can be >0; sensitivity is the ordering up > base > down)
    base_run = client.post("/simulate", json=dict(base)).json()
    up = client.post("/simulate", json=dict(base, price_adj=0.01)).json()
    dn = client.post("/simulate", json=dict(base, price_adj=-0.01)).json()
    assert up["delta"]["contribution"] > base_run["delta"]["contribution"] > dn["delta"]["contribution"]
    assert up["projection"]["contribution"] > base_run["projection"]["contribution"] > dn["projection"]["contribution"]


def test_ui_assumptions_cover_new_visuals():
    ass = client.get("/ui-assumptions").json()["assumptions"]
    assert len(ass) >= 22
    for prefix in ["D20", "D21", "D22"]:
        assert any(a.startswith(prefix) for a in ass), prefix
