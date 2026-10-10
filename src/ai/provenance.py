"""Validate a complete evidence graph without manufacturing missing sources."""
from collections import Counter


def validate_graph(sources, result):
    errors = []
    def index(rows, key):
        counts = Counter(r.get(key) for r in rows)
        for value, count in counts.items():
            if not value or count > 1:
                errors.append({'code': 'invalid_or_duplicate_id', 'kind': key, 'id': value})
        return {r.get(key): r for r in rows}
    source_map = index(sources, 'source_id')
    findings = index(result.get('findings', []), 'finding_id')
    clusters = index(result.get('clusters', []), 'cluster_id')
    index(result.get('proposed_requirements', []), 'requirement_id')
    for f in findings.values():
        source = source_map.get(f.get('source_id'))
        if source is None:
            errors.append({'code': 'missing_source', 'id': f.get('finding_id')})
        elif source.get('vehicle', source.get('vehicle_code')) != f.get('source_reference', {}).get('vehicle'):
            errors.append({'code': 'vehicle_mismatch', 'id': f['finding_id']})
        elif source.get('market', source.get('country_code')) != f.get('source_reference', {}).get('market'):
            errors.append({'code': 'market_mismatch', 'id': f['finding_id']})
    for source in sources:
        if source.get('source_catalog_page_id') and source['source_catalog_page_id'] not in source_map:
            errors.append({'code': 'missing_catalog_page', 'id': source['source_id']})
    for entity in result.get('clusters', []) + result.get('proposed_requirements', []):
        fids = entity.get('finding_ids', entity.get('linked_finding_ids', []))
        sids = entity.get('source_ids', entity.get('linked_source_ids', []))
        if any(x not in findings for x in fids) or any(x not in source_map for x in sids):
            errors.append({'code': 'broken_reference', 'id': entity.get('requirement_id', entity.get('cluster_id'))})
        if set(sids) != {findings[x]['source_id'] for x in fids if x in findings}:
            errors.append({'code': 'source_finding_mismatch'})
        if any(cid not in clusters for cid in entity.get('linked_cluster_ids', [])):
            errors.append({'code': 'missing_cluster_reference'})
    for link in result.get('evidence_links', []):
        if link.get('finding_id') not in findings or link.get('source_id') not in source_map:
            errors.append({'code': 'broken_evidence_link', 'id': link.get('link_id')})
    for conflict in result.get('conflicts', []):
        if any(fid not in findings for fid in conflict.get('finding_ids', [])) or any(
                sid not in source_map for sid in conflict.get('source_ids', [])):
            errors.append({'code': 'broken_conflict_reference', 'id': conflict.get('conflict_id')})
    return errors
