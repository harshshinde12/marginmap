"""SQLite connection helper. Same DDL runs on PostgreSQL (assumption A9)."""
from __future__ import annotations

import sqlite3
from pathlib import Path

# backend/app/database.py -> project root = parents[2]
ROOT = Path(__file__).resolve().parents[2]
DB_PATH = ROOT / "data" / "marginmap.db"


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn
