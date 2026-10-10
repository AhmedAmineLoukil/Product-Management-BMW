"""Deterministic conservative first pass, not semantic similarity or population counts."""
from difflib import SequenceMatcher
import re

def normalized(text):
    return ' '.join(re.findall(r'\w+', text.casefold()))

def cluster_findings(findings):
    clusters = []
    for finding in findings:
        if not finding['evidence_valid'] or finding['finding_type'] == 'unclear':
            continue
        match = None
        for cluster in clusters:
            reference = cluster['representative']
            left_scope = finding['source_reference']
            right_scope = reference['source_reference']
            if (finding['category'] == reference['category']
                and finding['finding_type'] == reference['finding_type']
                and left_scope['vehicle'] == right_scope['vehicle']
                and left_scope.get('market') == right_scope.get('market')):
                l, r = normalized(finding['summary']), normalized(reference['summary'])
                if l and r and SequenceMatcher(None, l, r).ratio() >= 0.90:
                    match = cluster
                    break
        if match is None:
            match = {'cluster_id': f'C{len(clusters)+1:04d}',
                     'representative': finding, 'finding_ids': [], 'source_ids': []}
            clusters.append(match)
        match['finding_ids'].append(finding['finding_id'])
        if finding['source_id'] not in match['source_ids']:
            match['source_ids'].append(finding['source_id'])
    for cluster in clusters:
        rep = cluster.pop('representative')
        for key in ('summary', 'category', 'finding_type'):
            cluster[key] = rep[key]
        cluster['market'] = rep['source_reference'].get('market')
        cluster['supporting_record_count'] = len(cluster['source_ids'])
        cluster['possible_near_duplicates'] = len(cluster['finding_ids']) > 1
    return clusters
