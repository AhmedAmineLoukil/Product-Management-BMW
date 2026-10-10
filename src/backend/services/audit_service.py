import json
from datetime import datetime, timezone
from src.backend.database import get_conn

def log_event(conn, requirement_id, action, actor, old_value, new_value, rationale):
    conn.execute(
        """INSERT INTO audit_events
           (requirement_id, action, actor, timestamp, old_value, new_value, rationale)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (requirement_id, action, actor, datetime.now(timezone.utc).isoformat(),
         json.dumps(old_value), json.dumps(new_value), rationale),
    )

def get_history(requirement_id):
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM audit_events WHERE requirement_id = ? ORDER BY event_id",
            (requirement_id,),
        ).fetchall()
    return [
        {
            "event_id": f"EVT-{r['event_id']:04d}",
            "requirement_id": r["requirement_id"],
            "action": r["action"],
            "actor": r["actor"],
            "timestamp": r["timestamp"],
            "old_value": json.loads(r["old_value"]),
            "new_value": json.loads(r["new_value"]),
            "rationale": r["rationale"],
        }
        for r in rows
    ]