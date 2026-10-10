"""Local REST presentation layer. Business rules remain in existing services."""
from pathlib import Path
from typing import Any, Literal
import os
from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, Field, ConfigDict
from src import copilot
from src.ai import db
from src.ai.scoring import WEIGHTS
from src.data.loader import DataRepository

class Contract(BaseModel):
    model_config = ConfigDict(extra='forbid')

class Scope(Contract):
    vehicle: str = Field(default='F70', pattern=r'^[A-Z0-9]{2,8}$')
    market: str = Field(default='GB', pattern=r'^[A-Z]{2}$')

class Decision(Contract):
    actor: str = Field(min_length=1, max_length=200)
    action: Literal['approve', 'reject', 'postpone', 'edit', 'challenge', 'score']
    rationale: str = Field(min_length=1, max_length=10000)
    expected_version: int = Field(ge=1)
    description: str | None = None
    review_date: str | None = None
    ratings: dict[str, int] | None = None
    score_rationales: dict[str, str] | None = None

class Workspace(Contract):
    runs: list[dict[str, Any]]
    selected_run: dict[str, Any] | None
    requirements: list[dict[str, Any]]
    findings: list[dict[str, Any]]
    sources: list[dict[str, Any]]
    inventory: list[dict[str, Any]]
    warnings: list[str]
    weights: dict[str, int]

class Detail(Contract):
    requirement: dict[str, Any]
    evidence: dict[str, Any]
    audit: list[dict[str, Any]]
    warnings: list[str]

def create_app(database=None, inventory=None):
    app = FastAPI(title='BMW Requirements Copilot', version='1.0')
    database = Path(database or os.getenv('BMW_DB_PATH', 'data/local/copilot.sqlite3'))
    inventory = Path(inventory or os.getenv('BMW_DATA_PATH', 'data/processed'))

    @app.exception_handler(KeyError)
    async def missing(_request, _exc):
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=404, content={'detail': 'Requirement not found'})

    @app.exception_handler(ValueError)
    async def invalid(_request, exc):
        from fastapi.responses import JSONResponse
        status = 409 if 'changed since' in str(exc) else 422
        return JSONResponse(status_code=status, content={'detail': str(exc)})

    @app.get('/api/health')
    def health():
        return {'status': 'ok'}

    @app.get('/api/workspace', response_model=Workspace)
    def workspace(vehicle: str = Query('F70', pattern=r'^[A-Z0-9]{2,8}$'),
                  market: str = Query('GB', pattern=r'^[A-Z]{2}$'), run_id: str | None = None):
        scope = Scope(vehicle=vehicle, market=market)
        eligible = [r for r in copilot.runs(database) if r['settings'].get('vehicle', 'F70') == scope.vehicle
                    and r['settings'].get('market', r['settings'].get('country_filter')) in (None, scope.market)]
        selected = next((r for r in eligible if r['run_id'] == run_id), None) if run_id else next(iter(eligible), None)
        if run_id and selected is None:
            raise HTTPException(404, 'Analysis not found in selected scope')
        data = copilot.run_data(database, selected['run_id']) if selected else {'sources': [], 'findings': []}
        requirements = [r for r in db.list_requirements(database) if selected and r['run_id'] == selected['run_id']
                        and r.get('vehicle_code') == vehicle and r.get('market') in (None, market)]
        records = [r for r in copilot.load_inventory(inventory).records if r.get('vehicle_code', r.get('vehicle')) == vehicle
                   and DataRepository.market(r) in (None, market, 'EU')]
        return dict(runs=eligible, selected_run=selected, requirements=requirements,
                    sources=data['sources'], findings=data['findings'], inventory=records,
                    warnings=copilot.scope_warnings(data['sources'] + records, market), weights=WEIGHTS)

    @app.get('/api/requirements/{requirement_id}', response_model=Detail)
    def detail(requirement_id: str):
        requirement = db.get_requirement(requirement_id, database)
        evidence = db.get_linked_evidence(requirement_id, database)
        return dict(requirement=requirement, evidence=evidence, audit=db.audit_history(requirement_id, database),
                    warnings=copilot.scope_warnings(evidence['sources'], requirement.get('market')))

    @app.post('/api/requirements/{requirement_id}/decisions', response_model=Detail)
    def decide(requirement_id: str, payload: Decision):
        db.revise_requirement(requirement_id, db_path=database, **payload.model_dump())
        return detail(requirement_id)

    @app.post('/api/analysis/synthetic')
    def synthetic(scope: Scope):
        return {'run_id': copilot.analyze(database, vehicle=scope.vehicle, market=scope.market, mode='synthetic')}

    @app.get('/api/audit')
    def audit(vehicle: str = Query('F70', pattern=r'^[A-Z0-9]{2,8}$'),
              market: str = Query('GB', pattern=r'^[A-Z]{2}$'), run_id: str | None = None):
        state = workspace(vehicle, market, run_id)
        events = [e for r in state['requirements'] for e in db.audit_history(r['requirement_id'], database)]
        return sorted(events, key=lambda e: (e['timestamp'], e['event_id']), reverse=True)

    return app

app = create_app()
