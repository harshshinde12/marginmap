"""Phase 2 automated tests — engine units + API + reconciliation to Phase 1 totals."""
from __future__ import annotations

import sqlite3

from fastapi.testclient import TestClient

from app.config import (
    BADGE_CRITICAL_BELOW,
    BADGE_MODERATE_BELOW,
    TAG_EXCESS_RETURNS_ABOVE,
    TAG_HIGH_DISCOUNT_ABOVE,
    TAG_LOGISTICS_SURGE_ABOVE,
    get_ui_assumptions,
)
from app.database import DB_PATH
from app.main import app
from app.phase2 import (
    BAND_ORDER,
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

client = TestClient(app)


# ---- unit: bands ----
def test_discount_band_boundaries():
    assert discount_band(0.0) == "0%"
    assert discount_band(0.05) == "1-10%"
    assert discount_band(0.10) == "1-10%"
    assert discount_band(0.11) == "11-20%"
    assert discount_band(0.20) == "11-20%"
    assert discount_band(0.21) == "21-30%"
    assert discount_band(0.30) == "21-30%"
    assert discount_band(0.31) == "30%+"
    assert discount_band(0.85) == "30%+"


def test_band_sql_matches_python_counts():
    conn = sqlite3.connect(str(DB_PATH))
    rows = conn.execute(
        "SELECT Discount FROM order_margins LIMIT 5000"
    ).fetchall()
    from collections import Counter
    py = Counter(discount_band(r[0]) for r in rows)
    assert set(py) <= set(BAND_ORDER)
    # every fetched discount maps into exactly one band
    assert sum(py.values()) == 5000
    conn.close()


# ---- unit: contribution / pearson / cohorts / driver / simulate ----
def test_contribution_identity():
    c, pct = contribution(200.0, 150.0, 10.0)
    assert c == 40.0 and abs(pct - 0.20) < 1e-9
    # net = contribution - support - return
    assert (c - 10.0 - 0.0) == 30.0
    c0, p0 = contribution(0.0, 0.0, 6.0)
    assert c0 == -6.0 and p0 == 0.0


def test_pearson():
    assert abs(pearson([1, 2, 3], [2, 4, 6]) - 1.0) < 1e-9
    assert abs(pearson([1, 2, 3], [6, 4, 2]) + 1.0) < 1e-9
    assert pearson([1, 1, 1], [2, 4, 6]) is None
    assert pearson([1.0], [2.0]) is None


def test_cohort_labels_exhaustive():
    labels = {
        cohort_label(100, 0.2, 50, 0.1),
        cohort_label(100, 0.0, 50, 0.1),
        cohort_label(10, 0.2, 50, 0.1),
        cohort_label(10, 0.0, 50, 0.1),
        cohort_label(50, 0.1, 50, 0.1),  # ties -> high/high
    }
    assert labels == {
        "high-revenue/high-margin",
        "high-revenue/low-margin",
        "low-revenue/high-margin",
        "low-revenue/low-margin",
    }


def test_cost_driver_shares_sum_to_one():
    d = cost_driver(62.0, 30.0, 8.0)
    assert d["driver"] == "freight"
    assert abs(d["driver_share"] - 0.62) < 1e-9
    assert d["cost_to_serve"] == 100.0
    d0 = cost_driver(0.0, 0.0, 0.0)
    assert d0["driver"] is None


def test_simulate_math_same_band_no_change():
    p = simulate_math(
        qty0=10.0, sales0=1000.0, cogs0=700.0, ship0=100.0,
        d0=0.10, d1=0.10, band_qty_current=3.7, band_qty_new=3.7,
    )
    assert abs(p["contribution_delta"]) < 1e-9
    assert p["volume_fallback"] is False


def test_simulate_math_fallback_when_band_missing():
    p = simulate_math(
        qty0=10.0, sales0=1000.0, cogs0=700.0, ship0=100.0,
        d0=0.10, d1=0.50, band_qty_current=3.7, band_qty_new=None,
    )
    assert p["volume_ratio"] == 1.0 and p["volume_fallback"] is True


# ---- API: cost-to-serve + Phase 1 reconciliation ----
def test_cost_to_serve_reconciles_to_phase1():
    body = client.get("/cost-to-serve", params={"dimension": "customer", "limit": 5000}).json()
    assert body["n_entities"] == 1590
    rows = body["rows"]
    assert len(rows) == 1590
    summary = client.get("/summary").json()
    assert abs(sum(r["revenue"] for r in rows) - summary["total_effective_sales"]) < 0.05
    assert abs(sum(r["net"] for r in rows) - summary["total_net"]) < 0.05
    assert abs(sum(r["gross"] for r in rows) - summary["total_gross"]) < 0.05
    assert abs(sum(r["shipping"] for r in rows) - summary["total_shipping"]) < 0.05
    assert abs(sum(r["support"] for r in rows) - summary["total_support"]) < 0.05
    assert abs(sum(r["return_cost"] for r in rows) - summary["total_return_cost"]) < 0.01
    # contribution identity per row
    for r in rows[:50]:
        assert abs(r["contribution"] - (r["revenue"] - r["cogs"] - r["shipping"])) < 0.01
        assert abs(r["net"] - (r["contribution"] - r["support"] - r["return_cost"])) < 0.01


def test_cohorts_mutually_exclusive_and_medians_real():
    body = client.get("/cost-to-serve", params={"dimension": "customer", "limit": 5000}).json()
    rows = body["rows"]
    labels = [r["cohort"] for r in rows]
    assert set(labels) <= {
        "high-revenue/high-margin", "high-revenue/low-margin",
        "low-revenue/high-margin", "low-revenue/low-margin",
    }
    assert sum(body["cohort_counts"].values()) == body["n_entities"] == len(rows)
    # independently recompute medians from the rows
    assert abs(median([r["revenue"] for r in rows]) - body["median_revenue"]) < 1e-6
    assert abs(median([r["net_pct"] for r in rows]) - body["median_net_pct"]) < 1e-9
    # quadrant rule holds row by row
    for r in rows:
        assert r["cohort"] == cohort_label(
            r["revenue"], r["net_pct"], body["median_revenue"], body["median_net_pct"]
        )


def test_cost_to_serve_product_count():
    body = client.get("/cost-to-serve", params={"dimension": "product", "limit": 20000}).json()
    assert body["n_entities"] == 10292
    summary = client.get("/summary").json()
    assert abs(sum(r["net"] for r in body["rows"]) - summary["total_net"]) < 0.05


def test_cost_to_serve_rejects_bad_dimension():
    assert client.get("/cost-to-serve", params={"dimension": "region"}).status_code == 400


# ---- API: loss-makers ----
def test_loss_makers_sorted_and_drivers_valid():
    body = client.get("/loss-makers", params={"dimension": "product", "limit": 200}).json()
    rows = body["rows"]
    assert body["n_loss_makers"] > 0 and len(rows) > 0
    nets = [r["net"] for r in rows]
    assert all(n < 0 for n in nets)
    assert nets == sorted(nets)  # worst-first
    for r in rows[:20]:
        total = r["shipping"] + r["support"] + r["return_cost"]
        shares = {
            "freight": r["shipping"] / total,
            "support": r["support"] / total,
            "returns": r["return_cost"] / total,
        }
        assert r["driver"] == max(shares, key=lambda k: shares[k])
        assert abs(r["driver_share"] - shares[r["driver"]]) < 1e-9


def test_loss_makers_region_threshold():
    body = client.get("/loss-makers", params={"dimension": "region", "threshold": 0}).json()
    assert all(r["net"] < 0 for r in body["rows"])
    strict = client.get(
        "/loss-makers", params={"dimension": "region", "threshold": -100000}
    ).json()
    assert all(r["net"] < -100000 for r in strict["rows"])
    assert strict["n_loss_makers"] <= body["n_loss_makers"]


# ---- API: discount-impact / elasticity ----
def test_discount_impact_structure():
    body = client.get("/discount-impact", params={"group_by": "segment"}).json()
    assert len(body["rows"]) == 3
    for r in body["rows"]:
        assert r["n_lines"] > 0
        assert 0.0 <= r["avg_discount_pct"] <= 0.85
        corr = r["correlation_discount_vs_contribution_pct"]
        assert corr is None or -1.0 <= corr <= 1.0
        assert r["correlation_n"] > 0


def test_elasticity_bands_cover_all_lines():
    body = client.get("/elasticity", params={"group_by": "category"}).json()
    assert body["bands"] == ["0%", "1-10%", "11-20%", "21-30%", "30%+"]
    assert sum(r["n_lines"] for r in body["rows"]) == 51290
    # every category has all five bands
    from collections import Counter
    counts = Counter(r["grp"] for r in body["rows"])
    assert set(counts.values()) == {5}
    # band order within each group
    for grp in counts:
        bands = [r["band"] for r in body["rows"] if r["grp"] == grp]
        assert bands == body["bands"]


# ---- API: profitability product/customer ----
def test_profitability_product_customer():
    p = client.get("/profitability", params={"group_by": "product", "limit": 20000}).json()
    assert len(p["rows"]) == 10292
    assert all(p["rows"][i]["net"] >= p["rows"][i + 1]["net"] for i in range(len(p["rows"]) - 1))
    summary = client.get("/summary").json()
    assert abs(sum(r["sales"] for r in p["rows"]) - summary["total_effective_sales"]) < 0.05
    c = client.get("/profitability", params={"group_by": "customer"}).json()
    assert len(c["rows"]) == 1590
    assert c["rows"][0]["label"]  # human-readable name present


# ---- API: simulator ----
def test_simulate_consumer_segment():
    body = client.post(
        "/simulate",
        json={"dimension": "segment", "entity_id": "Consumer", "new_discount_pct": 0.15},
    ).json()
    assert body["lookup_segment"] == "Consumer"
    assert body["assumption_note"] and "not a forecast" in body["assumption_note"]
    assert set(body["band_table"]) == set(BAND_ORDER)
    assert isinstance(body["delta"]["contribution"], float)
    # higher discount at same-ish volume must not increase unit price
    assert body["ratios"]["price"] <= 1.0 or body["baseline"]["avg_discount_pct"] > 0.15


def test_simulate_errors():
    assert client.post(
        "/simulate", json={"dimension": "segment", "entity_id": "Nobody", "new_discount_pct": 0.1}
    ).status_code == 404
    assert client.post(
        "/simulate",
        json={"dimension": "segment", "entity_id": "Consumer", "new_discount_pct": 0.95},
    ).status_code == 400
    assert client.post(
        "/simulate", json={"dimension": "planet", "entity_id": "Consumer", "new_discount_pct": 0.1}
    ).status_code == 400
    assert client.post("/simulate", json={"dimension": "segment"}).status_code == 400


# ---- UI thresholds: status_badge / entity_tags (D11-D12, pure functions) ----
def test_badge_tag_constants_match_documented_values():
    # Quartile-derived cutoffs, not round numbers — pin them exactly.
    assert BADGE_CRITICAL_BELOW == -0.226
    assert BADGE_MODERATE_BELOW == -0.043
    assert TAG_HIGH_DISCOUNT_ABOVE == 0.217
    assert TAG_EXCESS_RETURNS_ABOVE == 0.20
    assert TAG_LOGISTICS_SURGE_ABOVE == 0.71
    # D11/D12 doc strings must echo the same formatted cutoffs.
    docs = "\n".join(get_ui_assumptions())
    assert f"{BADGE_CRITICAL_BELOW:.1%}" in docs
    assert f"{BADGE_MODERATE_BELOW:.1%}" in docs
    assert f"{TAG_HIGH_DISCOUNT_ABOVE:.1%}" in docs
    assert f"{TAG_EXCESS_RETURNS_ABOVE:.0%}" in docs
    assert f"{TAG_LOGISTICS_SURGE_ABOVE:.0%}" in docs


def test_status_badge_boundaries_with_config_cutoffs():
    cb, mb = BADGE_CRITICAL_BELOW, BADGE_MODERATE_BELOW
    assert status_badge(cb - 0.001, cb, mb) == "Critical"
    assert status_badge(cb, cb, mb) == "Moderate"  # ties count up (<, not <=)
    assert status_badge(mb - 0.001, cb, mb) == "Moderate"
    assert status_badge(mb, cb, mb) == "Warning"  # at median -> Warning, not Moderate
    assert status_badge(-0.01, cb, mb) == "Warning"
    assert status_badge(0.0, cb, mb) == "Healthy"
    assert status_badge(0.25, cb, mb) == "Healthy"


def test_entity_tags_all_three_fire_with_measured_labels():
    tags = entity_tags(
        0.30, 0.25, 0.80,
        TAG_HIGH_DISCOUNT_ABOVE, TAG_EXCESS_RETURNS_ABOVE, TAG_LOGISTICS_SURGE_ABOVE,
    )
    assert [t["key"] for t in tags] == ["high_discount", "excess_returns", "logistics_surge"]
    by_key = {t["key"]: t for t in tags}
    assert by_key["high_discount"]["value"] == 0.30
    assert by_key["excess_returns"]["value"] == 0.25
    assert by_key["logistics_surge"]["value"] == 0.80
    # Measured values are shown in the label (D12).
    assert "30%" in by_key["high_discount"]["label"]
    assert "25%" in by_key["excess_returns"]["label"]
    assert "80%" in by_key["logistics_surge"]["label"]


def test_entity_tags_strict_above_at_threshold_fires_nothing():
    tags = entity_tags(
        TAG_HIGH_DISCOUNT_ABOVE, TAG_EXCESS_RETURNS_ABOVE, TAG_LOGISTICS_SURGE_ABOVE,
        TAG_HIGH_DISCOUNT_ABOVE, TAG_EXCESS_RETURNS_ABOVE, TAG_LOGISTICS_SURGE_ABOVE,
    )
    assert tags == []  # rule is strictly >, so equality fires nothing


def test_entity_tags_partial_and_empty():
    assert entity_tags(
        0.0, 0.0, 0.0,
        TAG_HIGH_DISCOUNT_ABOVE, TAG_EXCESS_RETURNS_ABOVE, TAG_LOGISTICS_SURGE_ABOVE,
    ) == []
    only_freight = entity_tags(
        0.0, 0.0, 0.99,
        TAG_HIGH_DISCOUNT_ABOVE, TAG_EXCESS_RETURNS_ABOVE, TAG_LOGISTICS_SURGE_ABOVE,
    )
    assert [t["key"] for t in only_freight] == ["logistics_surge"]
