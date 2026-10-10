"""Deterministic conservative first pass, not semantic similarity or population counts."""
from difflib import SequenceMatcher
import re
from collections import Counter

def normalized(text):
    return ' '.join(re.findall(r'\w+', text.casefold()))

def need_signature(finding):
    text = normalized(finding['summary'] + ' ' + finding['evidence_quote'])
    if re.search(r'\b(seat|seats|seating|sitze)\b', text) and re.search(
            r'\b(uncomfortable|discomfort|hurts|hurt|aches|ache|pain|unpleasant|unbequem)\b', text):
        return 'seat_discomfort'
    if re.search(r'\bback\b', text) and re.search(r'\b(hurts|hurt|aches|ache|pain)\b', text):
        return 'seat_discomfort'
    return None

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
                # A narrow topic plus complaint kind and category; review lexical
                # paraphrase merges instead of pretending this is an embedding model.
                signature = need_signature(finding)
                related = signature is not None and signature == need_signature(reference)
                if l and r and (SequenceMatcher(None, l, r).ratio() >= 0.90 or related):
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
        cluster['vehicle'] = rep['source_reference']['vehicle']
        cluster['needs_review'] = len(cluster['finding_ids']) > 1
        cluster['market_distribution'] = dict(Counter(
            next(f['source_reference'].get('market') or 'UNKNOWN' for f in findings if f['source_id'] == sid)
            for sid in cluster['source_ids']))
        cluster['supporting_record_count'] = len(cluster['source_ids'])
        cluster['possible_near_duplicates'] = len(cluster['finding_ids']) > 1
    return clusters
