"""Ingest Superstore workbook -> SQLite with full margin enrichment.

Run:  python -m app.ingest   (from backend/ directory)

Rate override:  MARGINMAP_SUPPORT_RATE_PCT=0.07 python -m app.ingest
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

import pandas as pd

from app.allocation import enrich_line
from app.config import RETURN_FEE, get_support_rate_pct

ROOT = Path(__file__).resolve().parents[2]
XLSX_PATH = ROOT / "data" / "superstore.xlsx"
DB_PATH = ROOT / "data" / "marginmap.db"


def main() -> dict:
    rate = get_support_rate_pct()
    orders = pd.read_excel(XLSX_PATH, sheet_name="Orders")
    returns = pd.read_excel(XLSX_PATH, sheet_name="Returns")
    returned_ids = set(returns["Order ID"].astype(str))

    orders["is_returned"] = orders["Order ID"].astype(str).isin(returned_ids).astype(int)

    total_original_sales = float(orders["Sales"].sum())
    total_pool = rate * total_original_sales

    enriched = []
    for _, r in orders.iterrows():
        calc = enrich_line(
            sales=float(r["Sales"]),
            native_profit=float(r["Profit"]),
            shipping=float(r["Shipping Cost"]),
            is_returned=bool(r["is_returned"]),
            total_sales=total_original_sales,
            total_pool=total_pool,
            fee=RETURN_FEE,
        )
        enriched.append(calc)

    calc_df = pd.DataFrame(enriched)
    out = pd.concat([orders.reset_index(drop=True), calc_df], axis=1)

    # Reconciliation totals (effective sales exclude reversed returned lines)
    recon = {
        "support_rate_pct": rate,
        "n_lines": int(len(out)),
        "n_returned_lines": int(out["is_returned"].sum()),
        "n_returned_order_ids": int(out.loc[out["is_returned"] == 1, "Order ID"].nunique()),
        "total_original_sales": float(out["Sales"].sum()),
        "total_effective_sales": float(out["sales_effective"].sum()),
        "total_cogs_original": float(out["cogs_original"].sum()),
        "total_cogs": float(out["cogs"].sum()),
        "total_gross": float(out["gross_margin"].sum()),
        "total_shipping": float(out["Shipping Cost"].sum()),
        "total_support_pool": float(total_pool),
        "total_support_allocated": float(out["allocated_support"].sum()),
        "total_return_cost": float(out["return_cost"].sum()),
        "total_net": float(out["net_margin"].sum()),
    }
    recon["support_recon_pct"] = (
        recon["total_support_allocated"] / recon["total_support_pool"] * 100
        if recon["total_support_pool"]
        else 0.0
    )
    recon["net_check"] = (
        recon["total_gross"]
        - recon["total_shipping"]
        - recon["total_support_allocated"]
        - recon["total_return_cost"]
    )
    recon["unexplained_variance"] = recon["total_net"] - recon["net_check"]
    recon["return_fee_check"] = RETURN_FEE * recon["n_returned_lines"]

    conn = sqlite3.connect(str(DB_PATH))
    conn.execute("DROP TABLE IF EXISTS order_margins")
    out.to_sql("order_margins", conn, index=False)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_margins_segment ON order_margins(Segment)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_margins_category ON order_margins(Category)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_margins_region ON order_margins(Region)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_margins_order ON order_margins([Order ID])")
    # Flags table survives re-ingest (created once, never dropped).
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
    conn.close()

    print("=== INGEST RECONCILIATION (real data, corrected) ===")
    for k, v in recon.items():
        print(f"{k} = {v}")
    return recon


if __name__ == "__main__":
    main()
