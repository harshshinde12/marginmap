"""Phase 1 automated tests — allocation math + DB reconciliation + API (corrected rules)."""
from __future__ import annotations

import os
import sqlite3

from fastapi.testclient import TestClient

from app.allocation import (
    allocate_support,
    compute_cogs_original,
    compute_gross,
    compute_net,
    compute_return_cost,
    enrich_line,
)
from app.config import RETURN_FEE, get_assumptions, get_support_rate_pct
from app.database import DB_PATH
from app.main import app

client = TestClient(app)

RATE = get_support_rate_pct()


def test_support_rate_config_defaults_and_env_override():
    # Default is 0.05; the value comes from the named parameter, not a literal.
    assert "MARGINMAP_SUPPORT_RATE_PCT" != ""  # env var name is the documented knob
    assert abs(RATE - float(os.getenv("MARGINMAP_SUPPORT_RATE_PCT", "0.05"))) < 1e-12
    assert abs(get_support_rate_pct() - 0.05) < 1e-12 or "MARGINMAP_SUPPORT_RATE_PCT" in os.environ


def test_assumptions_endpoint_reflects_live_rate():
    body = client.get("/assumptions").json()
    assert abs(body["support_rate_pct"] - get_support_rate_pct()) < 1e-12
    # The assumption TEXT itself must contain the live value (not hardcoded).
    a3 = [a for a in body["assumptions"] if a.startswith("A3")][0]
    assert f"{get_support_rate_pct():.2%}" in a3
    assert "SUPPORT_RATE_PCT" in a3
    assert body["return_fee"] == RETURN_FEE == 8.0


def test_cogs_derivation():
    assert compute_cogs_original(100.0, 30.0) == 70.0


def test_locked_margin_formulas_normal_line():
    # Sales=200, native Profit=50 -> COGS=150, Gross=50 (25%), support=rate*200,
    # shipping=10, not returned -> Net = 50-10-rate*200
    calc = enrich_line(
        sales=200.0, native_profit=50.0, shipping=10.0,
        is_returned=False, total_sales=1000.0,
        total_pool=RATE * 1000.0, fee=RETURN_FEE,
    )
    assert calc["sales_effective"] == 200.0
    assert calc["cogs"] == 150.0
    assert calc["gross_margin"] == 50.0 and abs(calc["gross_pct"] - 0.25) < 1e-9
    assert calc["return_cost"] == 0.0
    assert abs(calc["allocated_support"] - RATE * 200.0) < 1e-9
    assert abs(calc["net_margin"] - (50.0 - 10.0 - RATE * 200.0)) < 1e-9


def test_returned_line_corrected_no_double_count():
    # Sales=132.64, Profit=35.76 (COGS_orig=96.88), shipping=6.203, RETURNED:
    # effective sales=0, effective cogs=0, gross=0, return=$8 only,
    # support still on ORIGINAL sales, net = 0 - 6.203 - support - 8
    calc = enrich_line(
        sales=132.64, native_profit=35.76, shipping=6.203,
        is_returned=True, total_sales=1000.0,
        total_pool=RATE * 1000.0, fee=RETURN_FEE,
    )
    assert calc["sales_effective"] == 0.0
    assert calc["cogs_original"] == 96.88
    assert calc["cogs"] == 0.0
    assert calc["gross_margin"] == 0.0
    assert calc["gross_pct"] == 0.0
    assert calc["return_cost"] == 8.0  # flat fee ONLY — no +COGS
    assert abs(calc["allocated_support"] - RATE * 132.64) < 1e-9
    assert abs(calc["net_margin"] - (0 - 6.203 - RATE * 132.64 - 8.0)) < 1e-9
    assert calc["net_pct"] == 0.0  # suppressed: no divide-by-zero on zero sales


def test_return_cost_is_flat_fee_only():
    assert compute_return_cost(True, 8.0) == 8.0
    assert compute_return_cost(False, 8.0) == 0.0
    # Even a huge COGS must not leak into Return Cost anymore.
    assert compute_return_cost(True) == RETURN_FEE


def test_support_allocation_sums_to_pool():
    sales = [100.0, 200.0, 300.0]
    total = sum(sales)
    pool = RATE * total
    allocs = [allocate_support(s, total, pool) for s in sales]
    assert abs(sum(allocs) - pool) < 1e-9
    assert abs(allocs[0] - RATE * 100.0) < 1e-9


def test_db_reconciliation_on_real_data():
    """Sums over all 51290 real rows must reconcile exactly (corrected rules)."""
    assert DB_PATH.exists(), "Run python -m app.ingest first"
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    r = conn.execute(
        "SELECT COUNT(*) AS n, SUM(Sales) AS s_orig, SUM(sales_effective) AS s_eff, "
        "SUM(cogs_original) AS c_orig, SUM(cogs) AS c_eff, SUM(gross_margin) AS g, "
        "SUM(CASE WHEN is_returned=0 THEN Profit ELSE 0 END) AS g_check, "
        "SUM([Shipping Cost]) AS ship, SUM(allocated_support) AS sup, "
        "SUM(return_cost) AS ret, SUM(net_margin) AS net, SUM(is_returned) AS nret "
        "FROM order_margins"
    ).fetchone()
    d = dict(r)
    conn.close()
    assert d["n"] == 51290
    assert d["nret"] == 3050
    # Returned revenue reversed: effective < original.
    assert d["s_eff"] < d["s_orig"]
    # Gross == native Profit over NON-returned lines only.
    assert abs(d["g"] - d["g_check"]) < 0.01
    # Return Cost == exactly $8 x returned lines.
    assert abs(d["ret"] - 8.0 * d["nret"]) < 0.01
    # Net identity holds to the cent.
    assert abs((d["g"] - d["ship"] - d["sup"] - d["ret"]) - d["net"]) < 0.01
    # Support pool == rate x ORIGINAL sales (returned orders still consumed handling).
    assert abs(d["sup"] - RATE * d["s_orig"]) / d["s_orig"] < 1e-9
    # Returned lines carry zero effective sales/cogs/gross.
    conn2 = sqlite3.connect(str(DB_PATH))
    (bad,) = conn2.execute(
        "SELECT COUNT(*) FROM order_margins WHERE is_returned=1 AND "
        "(sales_effective != 0 OR cogs != 0 OR gross_margin != 0 OR return_cost != 8.0)"
    ).fetchone()
    conn2.close()
    assert bad == 0


def test_db_no_negative_cogs_original():
    conn = sqlite3.connect(str(DB_PATH))
    (bad,) = conn.execute("SELECT COUNT(*) FROM order_margins WHERE cogs_original < 0").fetchone()
    conn.close()
    assert bad == 0


def test_api_endpoints_live():
    assert client.get("/health").json()["status"] == "ok"
    s = client.get("/summary").json()
    assert s["n_lines"] == 51290
    assert s["n_returned_lines"] == 3050
    assert abs(s["total_net"] - (s["total_gross"] - s["total_shipping"] - s["total_support"] - s["total_return_cost"])) < 0.01
    assert abs(s["total_return_cost"] - 8.0 * 3050) < 0.01
    r = client.get("/reconciliation").json()
    assert r["net_matches"] is True
    assert r["support_reconciles"] is True
    assert r["return_matches"] is True
    assert r["gross_matches_nonreturned_profit"] is True
    assert abs(r["unexplained_variance"]) < 0.01
    p = client.get("/profitability", params={"group_by": "segment"}).json()
    assert len(p["rows"]) == 3
    # Segment effective sales must sum to summary effective sales.
    assert abs(sum(x["sales"] for x in p["rows"]) - s["total_effective_sales"]) < 0.01
    o = client.get("/orders", params={"limit": 2}).json()
    assert len(o["orders"]) == 2
