from fastapi import FastAPI, HTTPException
from src.backend.database import init_db
from src.backend.schemas import ReviewAction, EditRequest
from src.backend.services import requirement_service as rs
from src.backend.services import analysis_service
from src.backend.services.audit_service import get_history
from typing import Literal, get_args

init_db()
app = FastAPI(title="BMW Requirements Backend")

def _run(fn, *args):
    try:
        return fn(*args)
    except rs.NotFound:
        raise HTTPException(404, "Requirement not found")
    except rs.InvalidAction as e:
        raise HTTPException(400, str(e))

def _need_reason(body):
    if not body.rationale.strip():
        raise HTTPException(400, "A reason is required for this action")

@app.post("/analysis/run")
def run_analysis(vehicle: str = "G60", market: str = "Germany"):
    return analysis_service.run_analysis(vehicle, market)

@app.get("/requirements")
def list_requirements(vehicle: str | None = None, market: str | None = None, status: str | None = None, category: str | None = None):
    return rs.list_requirements(vehicle, market, status, category)

@app.get("/requirements/{rid}")
def get_requirement(rid: str):
    return _run(rs.get_requirement, rid)

@app.post("/requirements/{rid}/approve")
def approve(rid: str, body: ReviewAction):
    return _run(rs.change_status, rid, "approved", body.actor, body.rationale)

@app.post("/requirements/{rid}/reject")
def reject(rid: str, body: ReviewAction):
    _need_reason(body)
    return _run(rs.change_status, rid, "rejected", body.actor, body.rationale)

@app.post("/requirements/{rid}/challenge")
def challenge(rid: str, body: ReviewAction):
    _need_reason(body)
    return _run(rs.change_status, rid, "challenged", body.actor, body.rationale)

@app.patch("/requirements/{rid}")
def edit(rid: str, body: EditRequest):
    return _run(rs.edit_requirement, rid, body.changes, body.actor, body.rationale)

@app.get("/requirements/{rid}/history")
def history(rid: str):
    _run(rs.get_requirement, rid)       
    return get_history(rid)

@app.get("/categories")
def categories():
    return list(get_args(Category))