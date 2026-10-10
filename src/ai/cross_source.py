"""Conservative cross-source candidates. Topic overlap is not causal evidence."""
import re
from src.data.loader import DataRepository, stable_id

TOPICS = {
    'seating_comfort': {'seat', 'seats', 'seating', 'back', 'sitz', 'sitze'},
    'wireless_charging': {'wireless', 'charging', 'charger', 'inductive'},
    'climate_controls': {'climate', 'conditioning', 'temperature', 'klima'},
    'parking': {'parking', 'park', 'camera'},
    'connectivity': {'connectivity', 'bluetooth', 'carplay', 'android'},
    'space': {'boot', 'trunk', 'space', 'luggage'},
}


def topics(text):
    words = set(re.findall(r'\w+', text.lower()))
    return {key for key, terms in TOPICS.items() if words & terms}


def link_evidence(findings, references):
    links = []
    for finding in findings:
        if not finding.get('evidence_valid'):
            continue
        scope = finding['source_reference']
        ft = topics(finding['summary'] + ' ' + finding['evidence_quote'])
        for ref in references:
            if ref.get('vehicle_code', ref.get('vehicle')) != scope['vehicle']:
                continue
            kind = ref.get('record_type')
            text = ' '.join(str(ref.get(k) or '') for k in
                            ('feature_name_en', 'feature_name_original', 'metric', 'claim', 'text_original'))
            if kind != 'sales_volume' and not ft.intersection(topics(text)):
                continue
            market = DataRepository.market(ref)
            same_market = bool(market and scope.get('market') and market == scope['market'])
            relation = 'contextual' if same_market else 'unverified'
            reasons = ['Candidate topic overlap requires PM review.']
            if not same_market:
                reasons.append('Market scope differs or is unknown; availability cannot be transferred.')
            if kind == 'sales_volume':
                reasons.append('Sales volumes are context, never feature-demand proof.')
            if kind == 'vehicle_equipment':
                reasons.append('Presence in a catalog does not establish this customer vehicle configuration.')
                if ref.get('verification_status') != 'verified':
                    relation = 'unverified'
            # Only a curated, verified interpretation may assert support/contradiction.
            reviewed = ref.get('reviewed_evidence_relation')
            if same_market and ref.get('verification_status') == 'verified' and reviewed in {'supporting', 'contradictory'} and ref.get('review_rationale'):
                relation = reviewed
                reasons.append(ref['review_rationale'])
            links.append({'link_id': stable_id('LINK', finding['finding_id'], ref['source_id']),
                          'finding_id': finding['finding_id'], 'source_id': ref['source_id'],
                          'relation': relation, 'needs_review': True, 'limitations': reasons})
    return links


def detect_conflicts(findings, references, links):
    by_source = {s['source_id']: s for s in references}
    by_finding = {f['finding_id']: f for f in findings}
    conflicts = []
    for link in links:
        f, source = by_finding[link['finding_id']], by_source[link['source_id']]
        equipment_claim = source.get('record_type') == 'vehicle_equipment' and f['finding_type'] in {'complaint', 'unmet_need'}
        study = source.get('record_type') == 'customer_study_metric' and f['finding_type'] == 'complaint'
        if link['relation'] != 'contradictory' and not equipment_claim and not study:
            continue
        conflicts.append({'conflict_id': stable_id('CONFLICT', link['link_id']),
                          'finding_ids': [f['finding_id']],
                          'source_ids': [f['source_id'], source['source_id']],
                          'description': 'Potential disagreement requires interpretation; no automatic resolution.',
                          'possible_explanations': ['Different configuration, use case, market, or customer population.'],
                          'evidence_limitations': link['limitations'] + [
                              'Broad study scores do not invalidate a specific complaint; scale and sample may be unknown.'],
                          'recommended_action': 'Review original evidence and vehicle configuration with a PM.',
                          'needs_review': True})
    # Opposite signals about the same scoped topic remain separate findings.
    for i, left in enumerate(findings):
        for right in findings[i + 1:]:
            if not left.get('evidence_valid') or not right.get('evidence_valid'):
                continue
            if (left['finding_type'] == 'positive_feedback') == (right['finding_type'] == 'positive_feedback'):
                continue
            if left['source_reference']['vehicle'] != right['source_reference']['vehicle']:
                continue
            shared = topics(left['summary']) & topics(right['summary'])
            if not shared:
                continue
            conflicts.append({'conflict_id': stable_id('CONFLICT', sorted([left['finding_id'], right['finding_id']])),
                              'finding_ids': [left['finding_id'], right['finding_id']],
                              'source_ids': sorted({left['source_id'], right['source_id']}),
                              'description': 'Positive and negative signals concern a related customer experience.',
                              'possible_explanations': ['Preferences, markets, configurations or use cases differ.'],
                              'evidence_limitations': ['Topic matching is heuristic; signals may not refer to identical needs.'],
                              'recommended_action': 'Compare verbatim evidence and market distributions.', 'needs_review': True})
    return conflicts
