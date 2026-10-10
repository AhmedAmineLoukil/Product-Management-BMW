import sqlite3
import os
from pathlib import Path

DB_PATH = os.getenv("BMW_REVIEW_DB", "data/local/backend.sqlite3")

def get_conn():
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_conn() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS requirements (
            requirement_id TEXT PRIMARY KEY,
            data           TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS audit_events (
            event_id       INTEGER PRIMARY KEY AUTOINCREMENT,
            requirement_id TEXT NOT NULL,
            action         TEXT NOT NULL,
            actor          TEXT NOT NULL,
            timestamp      TEXT NOT NULL,
            old_value      TEXT,
            new_value      TEXT,
            rationale      TEXT
        );
        """)
