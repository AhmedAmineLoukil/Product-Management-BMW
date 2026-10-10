import sqlite3

DB_PATH = "app.db"

def get_conn():
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