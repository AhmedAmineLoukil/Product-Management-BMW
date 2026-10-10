"""Real AI entry points shared by the local website and legacy review API."""
import hashlib
import json
import os
import time
from threading import Lock
from src.ai import run_ai_pipeline
from src.ai.schemas import FeedbackRecord
from src.backend.schemas import Requirement
from src.backend.services.requirement_service import add_ai_proposal


def analyze_records(records, *, client=None):
    if not isinstance(records, list) or not 1 <= len(records) <= 50:
        raise ValueError('Select between 1 and 50 feedback records per live run.')
    valid = [FeedbackRecord.model_validate(r) for r in records]
    if len({r.source_id for r in valid}) != len(valid):
        raise ValueError('Duplicate source IDs are not allowed.')
    if len({(r.vehicle, r.market) for r in valid}) != 1:
        raise ValueError('Analyze one vehicle and market at a time.')
    if any(not r.text.strip() for r in valid):
        raise ValueError('Feedback must not be empty.')
    if sum(len(r.text) for r in valid) > 100_000:
        raise ValueError('Feedback exceeds the 100,000-character limit.')
    if client is None and not os.getenv('OPENAI_API_KEY'):
        raise ValueError('Set OPENAI_API_KEY in the server .env file and restart the app.')
    started = time.perf_counter()
    live = client is None
    if live:
        from openai import OpenAI
        client = OpenAI(timeout=60, max_retries=1)
    tracked = UsageTrackedClient(client)
    try:
        workers = min(4, max(1, int(os.getenv('AI_EXTRACT_WORKERS', '3')))) if live else 1
    except ValueError as exc:
        raise ValueError('AI_EXTRACT_WORKERS must be an integer from 1 to 4.') from exc
    try:
        result = run_ai_pipeline(records, client=tracked, workers=workers)
    except TypeError:
        # The main branch pipeline uses batch_size/stable_identifiers instead of
        # the integrated branch's worker parameter. Keep this bridge compatible
        # with both implementations.
        result = run_ai_pipeline(records, client=tracked, batch_size=2, stable_identifiers=True)
    # Never publish a partial, failed run as successful analysis.
    fatal = [e for e in result['validation_errors'] if e['code'] not in {
        'no_findings', 'semantic_clustering_failed_fallback_used'}]
    if fatal:
        raise ValueError('AI analysis could not validate the result: ' + ', '.join(sorted({e['code'] for e in fatal})))
    result['metrics'] = {
        'seconds': round(time.perf_counter() - started, 3),
        'api_calls': tracked.calls,
        'input_tokens': tracked.input_tokens,
        'output_tokens': tracked.output_tokens,
        'reasoning_tokens': tracked.reasoning_tokens,
        'model': os.getenv('OPENAI_MODEL', 'gpt-5-mini'),
        'extraction_workers': workers,
    }
    return _frontend_contract(result)


def _frontend_contract(result):
    """Adapt either backend pipeline shape to the root React app contract."""
    finding_by_id = {}
    for finding in result.get('findings', []):
        finding.setdefault('customer_need', finding.get('summary', ''))
        finding.setdefault('evidence_valid', bool(finding.get('evidence_quote')))
        finding_by_id[finding.get('finding_id')] = finding

    for cluster in result.get('clusters', []):
        members = [finding_by_id[fid] for fid in cluster.get('finding_ids', []) if fid in finding_by_id]
        representative = members[0] if members else {}
        cluster.setdefault('title', cluster.get('summary') or representative.get('summary') or 'Customer signal')
        cluster.setdefault('summary', representative.get('summary') or cluster.get('title', 'Customer signal'))
        cluster.setdefault('category', representative.get('category', cluster.get('category', 'Other')))
        cluster.setdefault('source_ids', list(dict.fromkeys(
            fid.get('source_id') for fid in members if fid.get('source_id'))))
        cluster.setdefault('uncertainty', '')

    for draft in result.get('proposed_requirements', []):
        draft.setdefault('rationale', draft.get('priority_rationale') or 'Source-linked proposal requiring PM review.')
        draft.setdefault('confidence', {'low': 'low', 'medium': 'medium', 'high': 'high'}.get(
            str(draft.get('evidence_confidence') or draft.get('evidence_level') or '').lower(), 'medium'))
        draft.setdefault('decision_status', 'pending')
        draft.setdefault('validation_errors', [])
        draft.setdefault('linked_source_ids', list(dict.fromkeys(
            finding_by_id[fid]['source_id'] for fid in draft.get('linked_finding_ids', [])
            if fid in finding_by_id and finding_by_id[fid].get('source_id'))))
    return result


class UsageTrackedClient:
    """Record actual response usage without logging feedback or credentials."""
    def __init__(self, client):
        self.client = client
        self.responses = self
        self.calls = self.input_tokens = self.output_tokens = self.reasoning_tokens = 0
        self.lock = Lock()

    def parse(self, **kwargs):
        response = self.client.responses.parse(**kwargs)
        usage = getattr(response, 'usage', None)
        with self.lock:
            self.calls += 1
            if usage:
                self.input_tokens += getattr(usage, 'input_tokens', 0) or 0
                self.output_tokens += getattr(usage, 'output_tokens', 0) or 0
                details = getattr(usage, 'output_tokens_details', None)
                self.reasoning_tokens += getattr(details, 'reasoning_tokens', 0) or 0
        return response


def run_analysis(vehicle, market):
    from src.ai.adapter import load_feedback_for_ai
    if vehicle != 'F70':
        raise ValueError('This legacy data endpoint supports F70. Use the website for other vehicles.')
    records, _ = load_feedback_for_ai('data/processed/feedback.jsonl', country=market, limit=20)
    result = analyze_records(records)
    saved = []
    for draft in result['proposed_requirements']:
        fingerprint = json.dumps([vehicle, market, sorted(draft['linked_source_ids']), draft['description']])
        req = Requirement(
            requirement_id='REQ-' + hashlib.sha256(fingerprint.encode()).hexdigest()[:16],
            vehicle=vehicle, market=market, description=draft['description'],
            finding_ids=draft['linked_finding_ids'], sources=draft['linked_source_ids'],
            priority_score=None, prioritization_rationale='Awaiting documented PM scoring.',
            evidence_level=draft['evidence_level'], future_assumptions=draft['assumptions'],
            uncertainties=draft['uncertainties'])
        saved.append(add_ai_proposal(req))
    return {'count': len(saved), 'requirements': saved, 'analysis': result}
