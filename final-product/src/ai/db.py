"""Local SQLite storage + append-only PM audit events; no network I/O."""
from __future__ import annotations
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
import json
import sqlite3
import uuid
from copy import deepcopy
from .scoring import observed_evidence, assess_priority

DEFAULT_DB = Path('data/local/pm_decisions.sqlite3')
STATUSES = {'pending', 'under_review', 'approved', 'rejected', 'postponed'}

def utcnow():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')

def dumps(x):
    return json.dumps(x, ensure_ascii=False, allow_nan=False, sort_keys=True)

@contextmanager
def connect(db_path=DEFAULT_DB):
    path = Path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys=ON')
    try:
        yield conn
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db(db_path=DEFAULT_DB):
    with connect(db_path) as c:
        c.executescript('''
          CREATE TABLE IF NOT EXISTS runs (
            run_id TEXT PRIMARY KEY, created_at TEXT NOT NULL,
            settings_json TEXT NOT NULL, summary_json TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS sources (
            run_id TEXT NOT NULL, source_id TEXT NOT NULL, body_json TEXT NOT NULL,
            PRIMARY KEY(run_id,source_id), FOREIGN KEY(run_id) REFERENCES runs(run_id)
          );
          CREATE TABLE IF NOT EXISTS findings (
            run_id TEXT NOT NULL, finding_id TEXT NOT NULL, body_json TEXT NOT NULL,
            PRIMARY KEY(run_id,finding_id), FOREIGN KEY(run_id) REFERENCES runs(run_id)
          );
          CREATE TABLE IF NOT EXISTS clusters (
            run_id TEXT NOT NULL, cluster_id TEXT NOT NULL, body_json TEXT NOT NULL,
            PRIMARY KEY(run_id,cluster_id), FOREIGN KEY(run_id) REFERENCES runs(run_id)
          );
          CREATE TABLE IF NOT EXISTS requirements (
            requirement_id TEXT PRIMARY KEY, run_id TEXT NOT NULL,
            version INTEGER NOT NULL, status TEXT NOT NULL,
            body_json TEXT NOT NULL, updated_at TEXT NOT NULL,
            FOREIGN KEY(run_id) REFERENCES runs(run_id)
          );
          CREATE TABLE IF NOT EXISTS audit_events (
            event_id INTEGER PRIMARY KEY AUTOINCREMENT,
            requirement_id TEXT NOT NULL, event_type TEXT NOT NULL,
            actor_type TEXT NOT NULL, actor_id TEXT NOT NULL,
            timestamp TEXT NOT NULL, old_json TEXT, new_json TEXT,
            rationale TEXT NOT NULL, metadata_json TEXT NOT NULL,
            FOREIGN KEY(requirement_id) REFERENCES requirements(requirement_id)
          );
          CREATE INDEX IF NOT EXISTS idx_audit_req ON audit_events(requirement_id,event_id);
        ''')
        # SQLite triggers prevent UPDATE and DELETE of audit history.
        c.executescript('''
          CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_events
          BEGIN SELECT RAISE(ABORT, 'audit events are append-only'); END;
          CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_events
          BEGIN SELECT RAISE(ABORT, 'audit events are append-only'); END;
        ''')


def _event(c, req_id, event, actor_type, actor_id, before, after, reason, metadata=None):
    c.execute('''INSERT INTO audit_events
        (requirement_id,event_type,actor_type,actor_id,timestamp,old_json,new_json,rationale,metadata_json)
        VALUES (?,?,?,?,?,?,?,?,?)''',
        (req_id,event,actor_type,actor_id,utcnow(),
         dumps(before) if before is not None else None,
         dumps(after) if after is not None else None,
         reason, dumps(metadata or {})))


def save_run(records, result, *, db_path=DEFAULT_DB, settings=None):
    init_db(db_path)
    run_id = uuid.uuid4().hex[:12]
    by_fid = {f['finding_id']: f for f in result['findings']}
    with connect(db_path) as c:
        c.execute('INSERT INTO runs VALUES (?,?,?,?)',
                  (run_id, utcnow(), dumps(settings or {}), dumps({
                      'source_count': len(records), 'finding_count': len(result['findings']),
                      'requirements_count': len(result['proposed_requirements']),
                      'validation_errors': result['validation_errors'],
                  })))
        for r in records:
            c.execute('INSERT INTO sources VALUES (?,?,?)', (run_id, r['source_id'], dumps(r)))
        for f in result['findings']:
            c.execute('INSERT INTO findings VALUES (?,?,?)', (run_id, f['finding_id'], dumps(f)))
        for cluster in result['clusters']:
            c.execute('INSERT INTO clusters VALUES (?,?,?)', (run_id, cluster['cluster_id'], dumps(cluster)))
        for draft in result['proposed_requirements']:
            req = deepcopy(draft)
            local_id = req['requirement_id']
            req_id = f'BMW-F70-{run_id}-{local_id}'
            req['requirement_id'] = req_id
            req['vehicle_code'] = 'F70'
            req['run_id'] = run_id
            req['status'] = 'pending'
            req['version'] = 1
            req['decision_status'] = 'pending'
            req['scoring_observations'] = observed_evidence(req, by_fid, len(records))
            req['priority_assessment'] = assess_priority(req['scoring_observations'], {}, {})
            req['scoring_rationale'] = 'Unassessed factors require a human PM; evidence triage is not final priority.'
            req['created_at'] = utcnow()
            c.execute('INSERT INTO requirements VALUES (?,?,?,?,?,?)',
                      (req_id, run_id, 1, 'pending', dumps(req), utcnow()))
            _event(c, req_id, 'requirement_proposed', 'AI', 'pipeline', None, req,
                   'AI proposal created; no autonomous approval.',
                   {'model': (settings or {}).get('model', 'unknown'), 'scoring_policy': 'F70-PM-v1',
                    'local_requirement_id': local_id})
    return run_id


def list_requirements(db_path=DEFAULT_DB):
    init_db(db_path)
    with connect(db_path) as c:
        rows = c.execute('SELECT body_json FROM requirements ORDER BY updated_at DESC').fetchall()
    return [json.loads(row['body_json']) for row in rows]


def get_requirement(requirement_id, db_path=DEFAULT_DB):
    init_db(db_path)
    with connect(db_path) as c:
        row = c.execute('SELECT body_json FROM requirements WHERE requirement_id=?',
                        (requirement_id,)).fetchone()
    if row is None:
        raise KeyError(f'Unknown requirement ID: {requirement_id}')
    return json.loads(row['body_json'])


def get_linked_evidence(requirement_id, db_path=DEFAULT_DB):
    req = get_requirement(requirement_id, db_path)
    with connect(db_path) as c:
        findings = []
        for fid in req['linked_finding_ids']:
            row = c.execute('SELECT body_json FROM findings WHERE run_id=? AND finding_id=?',
                            (req['run_id'], fid)).fetchone()
            if row:
                findings.append(json.loads(row[0]))
        sources = []
        for sid in req['linked_source_ids']:
            row = c.execute('SELECT body_json FROM sources WHERE run_id=? AND source_id=?',
                            (req['run_id'], sid)).fetchone()
            if row:
                sources.append(json.loads(row[0]))
    return {'findings': findings, 'sources': sources}


def audit_history(requirement_id, db_path=DEFAULT_DB):
    init_db(db_path)
    with connect(db_path) as c:
        rows = c.execute('SELECT * FROM audit_events WHERE requirement_id=? ORDER BY event_id',
                         (requirement_id,)).fetchall()
    return [{k: row[k] if k not in ('old_json','new_json','metadata_json') or row[k] is None
                     else json.loads(row[k]) for k in row.keys()} for row in rows]


def revise_requirement(requirement_id, *, actor, action, rationale, db_path=DEFAULT_DB,
                       description=None, ratings=None, score_rationales=None):
    """All writes are explicit human actions and appended atomically to history."""
    if not actor or not actor.strip() or not rationale or not rationale.strip():
        raise ValueError('Named PM actor and nonempty documented rationale required')
    if action not in ('approve', 'reject', 'postpone', 'challenge', 'edit', 'score'):
        raise ValueError('Unsupported PM action')
    init_db(db_path)
    with connect(db_path) as c:
        row = c.execute('SELECT body_json,status,version FROM requirements WHERE requirement_id=?',
                        (requirement_id,)).fetchone()
        if not row:
            raise KeyError(requirement_id)
        before = json.loads(row['body_json'])
        updated = deepcopy(before)
        if action == 'edit':
            if not isinstance(description, str) or not description.strip():
                raise ValueError('Edited description cannot be empty')
            updated['description'] = description.strip()
            updated['status'] = 'under_review'
        elif action == 'score':
            if not isinstance(ratings, dict) or not isinstance(score_rationales, dict):
                raise ValueError('Provide ratings and factor rationales')
            updated['priority_assessment'] = assess_priority(
                updated['scoring_observations'], ratings, score_rationales)
            updated['status'] = 'under_review'
        elif action == 'challenge':
            updated['status'] = 'under_review'
            updated['needs_review'] = True
        elif action == 'approve':
            if updated.get('validation_errors') or updated.get('evidence_level') == 'unsupported':
                raise ValueError('Cannot approve unsupported requirement')
            if updated.get('priority_assessment', {}).get('score') is None:
                raise ValueError('Complete documented PM scoring before approval')
            updated['status'] = 'approved'
        elif action == 'reject':
            updated['status'] = 'rejected'
        elif action == 'postpone':
            updated['status'] = 'postponed'
        updated['version'] = int(row['version']) + 1
        updated['decision_status'] = updated['status']
        updated['updated_at'] = utcnow()
        c.execute('UPDATE requirements SET version=?,status=?,body_json=?,updated_at=? WHERE requirement_id=?',
                  (updated['version'], updated['status'], dumps(updated), utcnow(), requirement_id))
        _event(c, requirement_id, 'pm_'+action, 'human', actor.strip(), before, updated, rationale.strip())
    return updated
