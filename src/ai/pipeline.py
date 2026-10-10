"""Synchronous AI orchestration; supports injected mocks and does not touch disk."""
from pydantic import ValidationError
from .clustering import cluster_findings
from .evidence import validate_finding, validate_requirement
from .extraction import extract_findings
from .requirements import generate_requirements
from .schemas import FeedbackRecord

def run_ai_pipeline(records, *, client=None, references=None, allow_external_data_transfer=False,
                    batch_size=1, stable_identifiers=False):
    from src.data.loader import stable_id
    if batch_size < 1:
        raise ValueError('batch_size must be positive')
    result = {'findings': [], 'clusters': [], 'proposed_requirements': [],
              'validation_errors': []}
    def error(code, **context):
        result['validation_errors'].append({'code': code, **context})
    if not isinstance(records, list):
        error('invalid_input', reason='records must be a list')
        return result
    accepted = {}
    duplicates = set()
    for index, raw in enumerate(records):
        try:
            record = FeedbackRecord.model_validate(raw)
        except (ValidationError, TypeError, ValueError):
            error('invalid_record', record_index=index)
            continue
        if record.source_id in accepted:
            duplicates.add(record.source_id)
            error('duplicate_source_id', source_id=record.source_id)
        else:
            accepted[record.source_id] = record
    for source_id in duplicates:
        accepted.pop(source_id, None)

    def get_client():
        nonlocal client
        if client is None:
            from .client import authorized_client
            client = authorized_client(allow_external_data_transfer=allow_external_data_transfer)
        return client

    batched = {}
    if batch_size > 1:
        from .extraction import extract_batch
        nonempty = [r for r in accepted.values() if r.text.strip()]
        for start in range(0, len(nonempty), batch_size):
            group = nonempty[start:start + batch_size]
            try:
                batched.update(extract_batch(get_client(), group))
            except Exception:
                for r in group:
                    batched[r.source_id] = None
    for record in accepted.values():
        if not record.text.strip():
            error('empty_feedback', source_id=record.source_id)
            continue
        try:
            extracted = batched[record.source_id] if batch_size > 1 else extract_findings(get_client(), record)
            if extracted is None:
                raise ValueError('Failed batch')
        except Exception:
            # Never put model exception text into output; it may include customer data.
            error('extraction_failed', source_id=record.source_id)
            continue
        if not extracted:
            error('no_findings', source_id=record.source_id)
        for item in extracted:
            finding = item.model_dump()
            finding.update(finding_id=f'F{len(result["findings"])+1:04d}',
                           source_id=record.source_id,
                           source_reference=record.model_dump(exclude_unset=True))
            if stable_identifiers:
                finding['finding_id'] = stable_id('FINDING', record.source_id, item.model_dump())
                if any(f['finding_id'] == finding['finding_id'] for f in result['findings']):
                    continue
            if finding['finding_type'] == 'unclear':
                finding['needs_review'] = True
            if not validate_finding(finding, accepted):
                error('invalid_evidence_quote', finding_id=finding['finding_id'],
                      source_id=record.source_id)
            result['findings'].append(finding)
    result['clusters'] = cluster_findings(result['findings'])
    if stable_identifiers:
        for cluster in result['clusters']:
            cluster['cluster_id'] = stable_id('CLUSTER', sorted(cluster['finding_ids']))
    from .cross_source import link_evidence, detect_conflicts
    references = references or []
    reference_ids = [r.get('source_id') for r in references]
    if any(not sid or sid in accepted for sid in reference_ids) or len(reference_ids) != len(set(reference_ids)):
        error('invalid_reference_source_ids')
        references = []
    result['evidence_links'] = link_evidence(result['findings'], references)
    result['conflicts'] = detect_conflicts(result['findings'], references, result['evidence_links'])
    if not result['clusters']:
        return result
    try:
        drafts = generate_requirements(get_client(), result['findings'], result['clusters'],
                                       evidence_links=result['evidence_links'], conflicts=result['conflicts'])
    except Exception:
        error('requirement_generation_failed')
        return result
    findings_by_id = {f['finding_id']: f for f in result['findings']}
    for index, draft in enumerate(drafts, 1):
        requirement = draft.model_dump()
        requirement['requirement_id'] = f'R{index:04d}'
        if stable_identifiers:
            requirement['requirement_id'] = stable_id('REQUIREMENT', requirement['description'],
                                                       sorted(requirement['linked_finding_ids']))
        for code in validate_requirement(requirement, findings_by_id, accepted):
            error(code, requirement_id=requirement['requirement_id'])
        linked = [findings_by_id[fid] for fid in requirement['linked_finding_ids'] if fid in findings_by_id]
        vehicles = {f['source_reference']['vehicle'] for f in linked}
        markets = {f['source_reference'].get('market') for f in linked}
        requirement['vehicle'] = next(iter(vehicles)) if len(vehicles) == 1 else None
        requirement['market'] = next(iter(markets)) if len(markets) == 1 else None
        requirement['linked_cluster_ids'] = [c['cluster_id'] for c in result['clusters']
                                             if set(c['finding_ids']) & set(requirement['linked_finding_ids'])]
        evidence = [l for l in result['evidence_links'] if l['finding_id'] in requirement['linked_finding_ids']]
        requirement['supporting_evidence'] = [l for l in evidence if l['relation'] == 'supporting']
        requirement['contradictory_evidence'] = [l for l in evidence if l['relation'] == 'contradictory']
        requirement['contextual_evidence'] = [l for l in evidence if l['relation'] in {'contextual', 'unverified'}]
        requirement['conflict_ids'] = [c['conflict_id'] for c in result['conflicts'] if set(c['finding_ids']) & set(requirement['linked_finding_ids'])]
        requirement['evidence_confidence'] = requirement['evidence_level']
        requirement['priority_rationale'] = 'Priority awaits deterministic scoring and documented PM assessment.'
        if requirement['conflict_ids'] or any(l['relation'] == 'unverified' for l in evidence):
            requirement['needs_review'] = True
            requirement['uncertainties'].append('Potential conflicts or unmatched market scopes require PM review.')
        result['proposed_requirements'].append(requirement)
    return result
