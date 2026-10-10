"""Deterministic evaluation against separately reviewed labels. No accuracy claims without labels."""
from itertools import combinations


def evaluate(records, result, labels=None):
    sources = {r['source_id'] for r in records}
    findings = result['findings']
    valid = [f for f in findings if f.get('evidence_valid')]
    metrics = {'evidence_validation_rate': len(valid) / len(findings) if findings else None,
               'source_traceability_coverage': sum(f['source_id'] in sources for f in findings) / len(findings) if findings else None,
               'unsupported_requirement_count': sum(r.get('evidence_level') == 'unsupported' for r in result['proposed_requirements']),
               'labeled_source_count': 0, 'extraction_exact_match_rate': None,
               'clustering_pair_precision': None, 'clustering_pair_recall': None}
    if not labels:
        return metrics
    by_source = {label['source_id']: label for label in labels}
    if len(by_source) != len(labels) or not set(by_source) <= sources:
        raise ValueError('Labels require distinct source IDs present in evaluation input')
    correct = 0
    expected_pairs = set()
    for sid, label in by_source.items():
        actual = sorted((f['finding_type'], f['category'], f['evidence_quote']) for f in valid if f['source_id'] == sid)
        expected = sorted((f['finding_type'], f['category'], f['evidence_quote']) for f in label['findings'])
        correct += actual == expected
    for a, b in combinations(sorted(by_source), 2):
        if by_source[a].get('need_group') and by_source[a].get('need_group') == by_source[b].get('need_group'):
            expected_pairs.add((a, b))
    predicted = set()
    for cluster in result['clusters']:
        predicted.update(combinations(sorted(set(cluster['source_ids']) & set(by_source)), 2))
    overlap = len(predicted & expected_pairs)
    metrics.update(labeled_source_count=len(labels), extraction_exact_match_rate=correct / len(labels),
                   clustering_pair_precision=overlap / len(predicted) if predicted else None,
                   clustering_pair_recall=overlap / len(expected_pairs) if expected_pairs else None)
    return metrics
