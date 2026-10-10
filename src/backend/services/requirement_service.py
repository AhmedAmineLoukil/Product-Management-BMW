from src.backend.database import get_conn
from src.backend.schemas import Requirement
from src.backend.services.audit_service import log_event

ALLOWED_TRANSITIONS = {
    "pending":    {"approved", "rejected", "challenged"},
    "challenged": {"approved", "rejected", "pending"},
    "approved":   {"challenged"},
    "rejected":   {"challenged"},
}
LOCKED_FIELDS = {"requirement_id", "decision_status"}   # can't be changed via "edit"

class NotFound(Exception): pass
class InvalidAction(Exception): pass

def _load(conn, rid):
    row = conn.execute("SELECT data FROM requirements WHERE requirement_id = ?", (rid,)).fetchone()
    if row is None:
        raise NotFound(rid)
    return Requirement.model_validate_json(row["data"])

def _save(conn, req):
    conn.execute(
        "INSERT OR REPLACE INTO requirements (requirement_id, data) VALUES (?, ?)",
        (req.requirement_id, req.model_dump_json()),
    )

def list_requirements(vehicle=None, market=None, status=None, category=None):
    with get_conn() as conn:
        rows = conn.execute("SELECT data FROM requirements").fetchall()
    reqs = [Requirement.model_validate_json(r["data"]) for r in rows]
    if vehicle: reqs = [r for r in reqs if r.vehicle == vehicle]
    if market:  reqs = [r for r in reqs if r.market == market]
    if status:  reqs = [r for r in reqs if r.decision_status == status]
    if category:
        reqs = [r for r in reqs if r.category == category]
    return sorted(reqs, key=lambda r: r.priority_score, reverse=True)

def get_requirement(rid):
    with get_conn() as conn:
        return _load(conn, rid)

def add_ai_proposal(req):
    """AI output always enters as 'pending' — the AI can never approve itself."""
    with get_conn() as conn:
        try:
            return _load(conn, req.requirement_id)   # already exists: don't overwrite human decisions
        except NotFound:
            pass
        req = req.model_copy(update={"decision_status": "pending"})
        _save(conn, req)
        log_event(conn, req.requirement_id, "created", "ai-engine", None,
                  req.model_dump(), "Proposed by AI pipeline")
        return req

def change_status(rid, new_status, actor, rationale):
    with get_conn() as conn:
        req = _load(conn, rid)
        old = req.decision_status
        if new_status not in ALLOWED_TRANSITIONS[old]:
            raise InvalidAction(f"Cannot change status from '{old}' to '{new_status}'")
        req.decision_status = new_status
        _save(conn, req)
        log_event(conn, rid, new_status, actor,
                  {"decision_status": old}, {"decision_status": new_status}, rationale)
        return req

def edit_requirement(rid, changes, actor, rationale):
    bad = (set(changes) & LOCKED_FIELDS) | (set(changes) - set(Requirement.model_fields))
    if bad:
        raise InvalidAction(f"These fields can't be edited: {sorted(bad)}")
    with get_conn() as conn:
        req = _load(conn, rid)
        old = {k: getattr(req, k) for k in changes}
        new = dict(changes)
        updated = Requirement(**{**req.model_dump(), **changes})   # re-validates the data
        if updated.decision_status == "approved":                  # edited content needs re-review
            updated.decision_status = "pending"
            old["decision_status"], new["decision_status"] = "approved", "pending"
        _save(conn, updated)
        log_event(conn, rid, "edited", actor, old, new, rationale)
        return updated