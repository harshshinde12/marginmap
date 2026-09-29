"""Phase 2 analytics engine — pure functions, no I/O.

Covers: contribution margin, discount bands (elasticity-lite),
2x2 revenue/margin cohorts, loss-maker drivers, policy simulator math.
DB access lives in main.py; everything here is unit-testable.
"""
from __future__ import annotations

import math

# Discount bands (elasticity-lite). Boundaries: d == 0 -> '0%';
# 0 < d <= 0.10 -> '1-10%'; 0.10 < d <= 0.20 -> '11-20%';
# 0.20 < d <= 0.30 -> '21-30%'; d > 0.30 -> '30%+'.
BAND_ORDER = ("0%", "1-10%", "11-20%", "21-30%", "30%+")

# SQL CASE fragment — must implement exactly the same boundaries.
BAND_CASE_SQL = (
    "CASE WHEN Discount = 0 THEN '0%' "
    "WHEN Discount <= 0.10 THEN '1-10%' "
    "WHEN Discount <= 0.20 THEN '11-20%' "
    "WHEN Discount <= 0.30 THEN '21-30%' "
    "ELSE '30%+' END"
)


def discount_band(d: float) -> str:
    if d == 0:
        return "0%"
    if d <= 0.10:
        return "1-10%"
    if d <= 0.20:
        return "11-20%"
    if d <= 0.30:
        return "21-30%"
    return "30%+"


def contribution(sales_effective: float, cogs_effective: float, shipping: float) -> tuple[float, float]:
    """Contribution = effective sales - effective COGS - shipping.

    DEVIATION from build-guide formula (documented in B2): the guide's
    `sales - discount_amount - cogs - variable` would subtract discount
    twice, because locked Phase 1 Sales is already net of discount.
    Support (shared/quasi-fixed) and return fees sit BELOW contribution:
    net = contribution - support - return_cost.
    """
    c = sales_effective - cogs_effective - shipping
    pct = c / sales_effective if sales_effective else 0.0
    return c, pct


def pearson(xs: list[float], ys: list[float]) -> float | None:
    """Pearson r; None when undefined (n < 2 or zero variance)."""
    n = len(xs)
    if n != len(ys) or n < 2:
        return None
    mx = sum(xs) / n
    my = sum(ys) / n
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    sxx = sum((x - mx) ** 2 for x in xs)
    syy = sum((y - my) ** 2 for y in ys)
    if sxx == 0 or syy == 0:
        return None
    return sxy / math.sqrt(sxx * syy)


def median(values: list[float]) -> float:
    s = sorted(values)
    n = len(s)
    if n == 0:
        return 0.0
    mid = n // 2
    return s[mid] if n % 2 else (s[mid - 1] + s[mid]) / 2


def cohort_label(revenue: float, margin_pct: float, med_rev: float, med_pct: float) -> str:
    """2x2 quadrant; ties (>=) count as 'high' on each axis."""
    hi_rev = revenue >= med_rev
    hi_mgn = margin_pct >= med_pct
    if hi_rev and hi_mgn:
        return "high-revenue/high-margin"
    if hi_rev and not hi_mgn:
        return "high-revenue/low-margin"
    if not hi_rev and hi_mgn:
        return "low-revenue/high-margin"
    return "low-revenue/low-margin"


def cost_driver(shipping: float, support: float, return_cost: float) -> dict:
    """Biggest cost-to-serve driver among freight/support/returns.

    Shares are of cost_to_serve = shipping + support + return_cost
    (COGS deliberately excluded: it would win ~always and hide the
    serve-cost story the cockpit needs).
    """
    total = shipping + support + return_cost
    if total <= 0:
        return {"driver": None, "driver_share": 0.0, "cost_to_serve": 0.0}
    shares = {
        "freight": shipping / total,
        "support": support / total,
        "returns": return_cost / total,
    }
    name = max(shares, key=lambda k: shares[k])
    return {"driver": name, "driver_share": shares[name], "cost_to_serve": total}


def simulate(
    qty0: float,
    sales0: float,
    cogs0: float,
    ship0: float,
    d0: float,
    d1: float,
    band_qty_current: float | None,
    band_qty_new: float | None,
    price_adj: float = 0.0,
    cogs_red: float = 0.0,
    ship_cut: float = 0.0,
    vol_override: float = 1.0,
) -> dict:
    """Volume/price projection for a discount change d0 -> d1.

    - Unit net price scales as (1-d1)/(1-d0) off the baseline unit price.
    - Volume scales as band_qty_new / band_qty_current (segment band table).
    - Unit COGS and unit shipping held constant.
    - Baseline covers NON-returned lines only.
    - Scenario sliders (D15): price_adj scales unit price; cogs_red scales unit
      COGS down; ship_cut scales borne unit shipping down; vol_override
      multiplies band-derived volume (1.0 = pure band elasticity).
    """
    p0 = sales0 / qty0 if qty0 else 0.0
    price_ratio = (1 - d1) / (1 - d0) if (1 - d0) != 0 else 1.0
    if band_qty_current and band_qty_new:
        vol_ratio = band_qty_new / band_qty_current
        vol_fallback = False
    else:
        vol_ratio = 1.0
        vol_fallback = True
    q1 = qty0 * vol_ratio * vol_override
    p1 = p0 * price_ratio * (1 + price_adj)
    sales1 = q1 * p1
    unit_cogs = (cogs0 / qty0 if qty0 else 0.0) * (1 - cogs_red)
    unit_ship = (ship0 / qty0 if qty0 else 0.0) * (1 - ship_cut)
    cogs1 = unit_cogs * q1
    ship1 = unit_ship * q1
    contrib0, _ = contribution(sales0, cogs0, ship0)
    contrib1, _ = contribution(sales1, cogs1, ship1)
    return {
        "qty_current": qty0,
        "qty_projected": q1,
        "sales_current": sales0,
        "sales_projected": sales1,
        "contribution_current": contrib0,
        "contribution_projected": contrib1,
        "contribution_delta": contrib1 - contrib0,
        "price_ratio": price_ratio,
        "volume_ratio": vol_ratio,
        "volume_fallback": vol_fallback,
    }


def build_variance_narrative(
    month: str,
    prev: str,
    cur_net_pp: float,
    prev_net_pp: float,
    cur_disc: float,
    prev_disc: float,
    cur_qty: float,
    prev_qty: float,
    top_driver: str,
    top_driver_delta: float,
    worst_category: str | None,
    worst_category_delta: float,
) -> str:
    """Rules-based monthly variance sentence set.

    Headline rule (B5 reframe): lead with the margin movement plus its
    dollar driver and the volume-vs-discount band evidence. The raw
    discount/contribution correlation is never cited — it is mechanical.
    """
    d_pp = (cur_net_pp - prev_net_pp) * 100
    direction = "rose" if d_pp >= 0 else "fell"
    d_disc_pp = (cur_disc - prev_disc) * 100
    d_qty = cur_qty - prev_qty
    driver_word = {
        "gross": "gross-margin movement",
        "shipping": "freight (shipping) costs",
        "support": "allocated support costs",
        "return": "return fees",
    }.get(top_driver, top_driver)
    vol_word = (
        "volume held broadly flat"
        if abs(d_qty) < 0.15
        else (f"average quantity rose {d_qty:.2f} units/line" if d_qty > 0 else f"average quantity fell {abs(d_qty):.2f} units/line")
    )
    disc_word = (
        f"average discount moved {d_disc_pp:+.1f}pp to {cur_disc:.1%}"
        if abs(d_disc_pp) >= 0.05
        else f"average discount was steady at {cur_disc:.1%}"
    )
    cat_word = (
        f" The largest category swing was {worst_category} ({worst_category_delta:+,.0f} net)."
        if worst_category
        else ""
    )
    return (
        f"Net margin {direction} {abs(d_pp):.1f}pp in {month} vs {prev} "
        f"({prev_net_pp:.1%} to {cur_net_pp:.1%}), driven mainly by {driver_word} "
        f"({top_driver_delta:+,.0f} dollars of the net change); {disc_word} while {vol_word} — "
        f"consistent with the elasticity-lite finding that discounts erode contribution without "
        f"lifting quantity.{cat_word}"
    )


def status_badge(net_pct: float, critical_below: float, moderate_below: float) -> str:
    """Badge from the data-derived cutoffs (D11)."""
    if net_pct < critical_below:
        return "Critical"
    if net_pct < moderate_below:
        return "Moderate"
    if net_pct < 0:
        return "Warning"
    return "Healthy"


def entity_tags(
    avg_discount: float,
    return_rate: float,
    freight_share: float,
    disc_above: float,
    ret_above: float,
    freight_above: float,
) -> list[dict]:
    """Rule-based root-cause tags with measured values shown (D12)."""
    tags: list[dict] = []
    if avg_discount > disc_above:
        tags.append(
            {"key": "high_discount", "label": f"High Discounting ({avg_discount:.0%} avg)",
             "value": avg_discount}
        )
    if return_rate > ret_above:
        tags.append(
            {"key": "excess_returns", "label": f"Excessive Returns ({return_rate:.0%} of lines)",
             "value": return_rate}
        )
    if freight_share > freight_above:
        tags.append(
            {"key": "logistics_surge", "label": f"Logistics Surge ({freight_share:.0%} freight share)",
             "value": freight_share}
        )
    return tags
