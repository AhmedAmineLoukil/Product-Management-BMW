"""Application services. All analysis is explicit; offline demos never use a network."""
from pathlib import Path
import csv
import io
import json
import time
from src.ai.db import connect, init_db, save_run, list_requirements, utcnow, dumps
from src.ai.pipeline import run_ai_pipeline
from src.ai.provenance import validate_graph
from src.ai.evaluation import evaluate
from src.data.loader import DataRepository, normalize_feedback, read_records
from src.ai.adapter import adapt_feedback


def runs(db):
    init_db(db)
    with connect(db) as c:
        return [dict(run_id=r['run_id'], created_at=r['created_at'],
                     settings=json.loads(r['settings_json']), summary=json.loads(r['summary_json']))
                for r in c.execute('SELECT * FROM runs ORDER BY created_at DESC, rowid DESC')]


def run_data(db, run_id):
    init_db(db)
    with connect(db) as c:
        return {table: [json.loads(r[0]) for r in c.execute(
            f'SELECT body_json FROM {table} WHERE run_id=?', (run_id,))]
                for table in ('sources', 'findings', 'clusters')}


def load_inventory(directory):
    # Legacy feedback lacks record_type. Normalize it through the existing adapter.
    repo = DataRepository.from_directory(directory)
    path = Path(directory) / 'feedback.jsonl'
    if path.exists() and not repo.load_feedback('F70'):
        legacy = read_records(path)
        if legacy and not legacy[0].get('record_type'):
            repo = repo.merge(normalize_feedback(legacy, vehicle='F70'))
    return repo


def scope_warnings(records, market):
    messages = set()
    for r in records:
        scope = DataRepository.market(r)
        if scope and scope != market:
            messages.add(f'{scope} source coverage does not establish {market}-specific evidence or availability.')
        if r.get('record_type') == 'sales_volume':
            messages.add('Check sales value type: forecasts are not historical observations.')
        if r.get('record_type') in ('vehicle_equipment', 'equipment_catalog_page') and r.get('verification_status') != 'verified':
            messages.add('Unverified equipment associations do not confirm feature availability.')
    return sorted(messages)


def analyze(db, *, vehicle, market, mode='synthetic', records=None, references=None,
            model=None, authorized=False):
    start = time.perf_counter()
    if mode == 'synthetic':
        from scripts.run_pipeline import SyntheticClient
        from scripts.run_ai_f70 import SYNTHETIC
        # Scope is explicitly assigned to fictional records, never to BMW observations.
        records = [dict(r, vehicle=vehicle, market=market) for r in SYNTHETIC]
        references = []
        client = SyntheticClient()
        model = 'offline deterministic fixture'
    elif mode == 'live':
        if not authorized:
            raise PermissionError('Explicit confidential-data transfer authorization required.')
        from src.ai.client import authorized_client
        client = authorized_client(allow_external_data_transfer=True, model=model,
                                   cache_dir=Path(db).parent / 'private_cache')
        model = client.model
    else:
        raise ValueError('Unsupported analysis mode')
    if not records:
        raise ValueError('No feedback records in selected scope')
    result = run_ai_pipeline(records, client=client, references=references or [],
                             batch_size=2, stable_identifiers=True)
    graph = validate_graph(records + (references or []), result)
    # Keep partial findings available; unsupported proposals cannot be approved.
    result['validation_errors'].extend(graph)
    if graph:
        for proposal in result['proposed_requirements']:
            proposal.setdefault('validation_errors', []).append('run_graph_requires_review')
            proposal['evidence_level'] = 'unsupported'
            proposal['evidence_confidence'] = 'unsupported'
    metrics = evaluate(records + (references or []), result)
    metrics.update(records_processed=len(records), findings_extracted=len(result['findings']),
                   requirements_generated=len(result['proposed_requirements']),
                   processing_seconds=round(time.perf_counter() - start, 4),
                   usage=getattr(client, 'usage', {'requests': 0, 'estimated_cost_usd': 0}))
    return save_run(records + (references or []), result, db_path=db,
                    settings={'vehicle': vehicle, 'market': market, 'mode': mode, 'model': model},
                    metrics=metrics)


def portfolio_export(db, requirements, actor, format='json'):
    if not actor.strip():
        raise ValueError('Named demo actor required for export')
    if format not in ('json', 'csv'):
        raise ValueError('Unsupported export format')
    # Re-fetch persisted state: export never relies on stale UI dictionaries.
    ids = {r['requirement_id'] for r in requirements}
    rows = [dict(r, priority_score=r.get('priority_assessment', {}).get('score'),
                 priority=r.get('priority_assessment', {}).get('priority'),
                 prioritization_rationale=r.get('priority_assessment', {}).get('rationales', {}))
            for r in list_requirements(db) if r['requirement_id'] in ids]
    if format == 'json':
        payload = json.dumps(rows, ensure_ascii=False, indent=2)
    else:
        buf = io.StringIO(newline='')
        columns = sorted({k for r in rows for k in r}) or ['requirement_id']
        writer = csv.DictWriter(buf, fieldnames=columns)
        writer.writeheader()
        for r in rows:
            values = {k: json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list)) else v for k, v in r.items()}
            # Prevent spreadsheet formula execution in user-controlled text.
            values = {k: "'" + v if isinstance(v, str) and v.startswith(('=', '+', '-', '@', '\t', '\r')) else v for k, v in values.items()}
            writer.writerow(values)
        payload = buf.getvalue()
    destination = Path(db).parent / 'exports'
    destination.mkdir(parents=True, exist_ok=True)
    from uuid import uuid4
    path = destination / f'portfolio-{uuid4().hex}.{format}'
    path.write_text(payload, encoding='utf-8')
    with connect(db) as c:
        c.execute('INSERT INTO workflow_events (event_type,actor_type,actor_id,timestamp,body_json) VALUES (?,?,?,?,?)',
                  ('portfolio_export', 'human', actor.strip(), utcnow(), dumps({
                      'requirement_ids': sorted(ids), 'format': format, 'local_file': path.name,
                      'unauthenticated_demo_actor': True})))
    return payload
