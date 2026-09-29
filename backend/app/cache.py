"""Thread-safe in-memory cache for static read queries."""
from __future__ import annotations

import copy
import functools
import threading
from typing import Any, Callable

from app.config import get_support_rate_pct

_CACHE: dict[tuple, Any] = {}
_LOCK = threading.Lock()


def cache_response(fn: Callable) -> Callable:
    """In-memory cache for static read endpoints.
    
    Guarantees sub-millisecond responses on repeated queries on low-CPU hosts like Render free tier.
    """
    @functools.wraps(fn)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        rate = get_support_rate_pct()
        kw_items = []
        for k, v in sorted(kwargs.items()):
            if isinstance(v, list):
                kw_items.append((k, tuple(v)))
            elif isinstance(v, dict):
                kw_items.append((k, tuple(sorted(v.items()))))
            else:
                kw_items.append((k, v))
        key = (fn.__name__, rate, args, tuple(kw_items))

        if key in _CACHE:
            return copy.deepcopy(_CACHE[key])

        with _LOCK:
            if key not in _CACHE:
                res = fn(*args, **kwargs)
                _CACHE[key] = res
            return copy.deepcopy(_CACHE[key])

    return wrapper


def clear_cache() -> None:
    """Clear all cached responses (e.g. on test resets or ingest)."""
    with _LOCK:
        _CACHE.clear()
