"""Phase 3 backend tests — variance endpoint + correlation reframe."""
from __future__ import annotations

import sqlite3

from fastapi.testclient import TestClient

from app.database import DB_PATH
from app.main import app
from app.phase2 import build_variance_narrative

client = TestClient(app)


def test_variance_latest_month_defaults_and_reconciles():
    body = client.get("/variance").json()
    assert body["month"] == "2014-12" and body["previous_month"] == "2014-11"
    cur, prv, d = body["current"], body["previous"], body["deltas"]
    assert abs(d["net"] - (cur["net"] - prv["net"])) < 0.01
    assert abs(d["revenue"] - (cur["revenue"] - prv["revenue"])) < 0.01
    # drivers explain the full dollar net change
    assert abs(sum(x["delta_net_dollars"] for x in body["drivers"]) - d["net"]) < 0.01
    # category swings sum to the same net change
    assert abs(sum(x["delta_net"] for x in body["category_net_swings"]) - d["net"]) < 0.01
    # reframe: narrative never cites the mechanical correlation
    assert "correlation" not in body["narrative"].lower()
    assert body["month"] in body["narrative"] and body["previous_month"] in body["narrative"]


def test_variance_explicit_month_matches_independent_sql():
    body = client.get("/variance", params={"month": "2014-06"}).json()
    assert body["month"] == "2014-06" and body["previous_month"] == "2014-05"
    conn = sqlite3.connect(str(DB_PATH))
    try:
        rev = conn.execute(
            "SELECT SUM(sales_effective) FROM order_margins "
            "WHERE substr([Order Date], 1, 7) = '2014-06'"
        ).fetchone()[0]
        net = conn.execute(
            "SELECT SUM(net_margin) FROM order_margins "
            "WHERE substr([Order Date], 1, 7) = '2014-06'"
        ).fetchone()[0]
    finally:
        conn.close()
    assert abs(body["current"]["revenue"] - rev) < 0.01
    assert abs(body["current"]["net"] - net) < 0.01


def test_variance_all_months_sum_to_summary():
    conn = sqlite3.connect(str(DB_PATH))
    try:
        months = [
            r[0]
            for r in conn.execute(
                "SELECT DISTINCT substr([Order Date], 1, 7) FROM order_margins ORDER BY 1"
            ).fetchall()
        ]
    finally:
        conn.close()
    assert months[0] == "2011-01" and months[-1] == "2014-12" and len(months) == 48
    total_rev, total_net = 0.0, 0.0
    for m in months[1:]:  # every month except the first has a previous month
        b = client.get("/variance", params={"month": m}).json()
        total_rev += b["current"]["revenue"]
        total_net += b["current"]["net"]
    first = client.get("/variance", params={"month": months[1]}).json()["previous"]
    total_rev += first["revenue"]
    total_net += first["net"]
    summary = client.get("/summary").json()
    assert abs(total_rev - summary["total_effective_sales"]) < 0.05
    assert abs(total_net - summary["total_net"]) < 0.05


def test_variance_error_cases():
    assert client.get("/variance", params={"month": "not-a-month"}).status_code == 400
    assert client.get("/variance", params={"month": "2010-12"}).status_code == 404
    assert client.get("/variance", params={"month": "2015-01"}).status_code == 404
    assert client.get("/variance", params={"month": "2011-01"}).status_code == 404


def test_narrative_builder_unit():
    s = build_variance_narrative(
        month="2014-12", prev="2014-11",
        cur_net_pp=-0.05, prev_net_pp=-0.02,
        cur_disc=0.14, prev_disc=0.12,
        cur_qty=3.40, prev_qty=3.42,
        top_driver="shipping", top_driver_delta=-5000.0,
        worst_category="Technology", worst_category_delta=-8000.0,
    )
    assert "fell 3.0pp" in s and "2014-12 vs 2014-11" in s
    assert "freight (shipping) costs" in s
    assert "Technology" in s and "elasticity-lite" in s
    assert "correlation" not in s.lower()


def test_discount_impact_carries_reframe_note():
    body = client.get("/discount-impact", params={"group_by": "segment"}).json()
    assert "interpretation_note" in body
    note = body["interpretation_note"].lower()
    assert "mechanical" in note and "never the raw correlation" in note


def test_phase2_assumptions_reframed():
    body = client.get("/phase2-assumptions").json()
    b5 = [a for a in body["assumptions"] if a.startswith("B5")][0].lower()
    assert "mechanical" in b5 and "never headline" in b5
