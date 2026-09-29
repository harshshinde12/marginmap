"""Cost allocation engine — pure functions, no I/O.

All Phase-1 money math lives here so tests can prove correctness
without a database. Implements the CORRECTED returns rule:
returned lines reverse the sale (effective sales/COGS/gross = 0),
Return Cost = $8 flat fee only, support still on ORIGINAL sales.
"""
from __future__ import annotations


def compute_cogs_original(sales_original: float, native_profit: float) -> float:
    """COGS_original = Sales_original - native Profit (assumption A1)."""
    return sales_original - native_profit


# Backwards-compatible alias (effective COGS differs on returned lines).
def compute_cogs(sales: float, native_profit: float) -> float:
    return compute_cogs_original(sales, native_profit)


def compute_return_cost(is_returned: bool, fee: float = 8.0) -> float:
    """Return Cost = flat fee ONLY if returned, else 0 (assumption A6 corrected).

    The old '+ COGS' term is intentionally gone — COGS on returned lines
    is reversed (COGS_effective = 0), never charged as a write-off.
    """
    return fee if bool(is_returned) else 0.0


def allocate_support(sales_original: float, total_original_sales: float, total_pool: float) -> float:
    """Original-Sales-proportional allocation key (assumptions A3/A4).

    Applies to every line INCLUDING returned lines. Sums to total_pool.
    """
    if total_original_sales <= 0:
        return 0.0
    return sales_original / total_original_sales * total_pool


def compute_gross(sales_effective: float, cogs_effective: float) -> tuple[float, float]:
    """Return (gross_margin, gross_pct). pct = 0 when effective sales == 0."""
    gross = sales_effective - cogs_effective
    pct = gross / sales_effective if sales_effective else 0.0
    return gross, pct


def compute_net(
    gross: float, shipping: float, support_alloc: float, return_cost: float, sales_effective: float
) -> tuple[float, float]:
    """Return (net_margin, net_pct). pct uses EFFECTIVE sales; 0 when 0."""
    net = gross - shipping - support_alloc - return_cost
    pct = net / sales_effective if sales_effective else 0.0
    return net, pct


def enrich_line(
    sales: float,
    native_profit: float,
    shipping: float,
    is_returned: bool,
    total_sales: float,
    total_pool: float,
    fee: float = 8.0,
) -> dict:
    """Full per-line calculation. `sales`/`total_sales` are ORIGINAL sales.

    Returned line: sales_effective=0, cogs(effective)=0, gross=0,
    return_cost=fee, support=rate*original sales,
    net = 0 - shipping - support - fee.
    """
    cogs_original = compute_cogs_original(sales, native_profit)
    sales_effective = 0.0 if is_returned else sales
    cogs_effective = 0.0 if is_returned else cogs_original
    support = allocate_support(sales, total_sales, total_pool)
    ret = compute_return_cost(bool(is_returned), fee)
    gross, gross_pct = compute_gross(sales_effective, cogs_effective)
    net, net_pct = compute_net(gross, shipping, support, ret, sales_effective)
    return {
        "sales_effective": sales_effective,
        "cogs_original": cogs_original,
        "cogs": cogs_effective,
        "allocated_support": support,
        "return_cost": ret,
        "gross_margin": gross,
        "gross_pct": gross_pct,
        "net_margin": net,
        "net_pct": net_pct,
    }
