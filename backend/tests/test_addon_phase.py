"""ADD-ON PHASE reconciliation — state leaderboards source + new assumption lettering."""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_state_profitability_reconciles_to_summary():
    body = client.get("/profitability", params={"group_by": "state", "limit": 2000}).json()
    assert body["group_by"] == "state"
    assert len(body["rows"]) > 50  # covers all 1,094 global states
    summary = client.get("/summary").json()
    total = sum(r["net"] for r in body["rows"])
    assert abs(total - summary["total_net"]) < 0.05
    # rows arrive net DESC (backend ORDER BY net DESC)
    nets = [r["net"] for r in body["rows"]]
    assert nets == sorted(nets, reverse=True)
    # Top-5 / Bottom-5 leaderboards slice without overlap
    top5 = body["rows"][:5]
    bottom5 = body["rows"][-5:]
    assert len(top5) == 5 and len(bottom5) == 5
    assert {r["grp"] for r in top5}.isdisjoint({r["grp"] for r in bottom5})
    assert min(r["net"] for r in top5) >= max(r["net"] for r in bottom5)
    for r in top5 + bottom5:
        assert set(r) >= {"grp", "label", "sales", "net", "net_pct"}


def test_ui_assumptions_cover_addon_lettering():
    ass = client.get("/ui-assumptions").json()["assumptions"]
    assert len(ass) >= 27
    for prefix in ["D20", "D21", "D22", "D23", "D24", "D25", "D26", "D27"]:
        assert any(a.startswith(prefix) for a in ass), prefix
