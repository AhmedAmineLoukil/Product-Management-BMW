"""Explainable prioritization: no invented ratings, no automated approval.

AI output receives a triage signal; PM supplies missing qualitative ratings.
The score is only final (reviewed) when all factors receive documented ratings.
"""
from __future__ import annotations
from copy import deepcopy

WEIGHTS = {
    'customer_frequency': 25,
    'customer_impact': 25,
    'market_relevance': 15,
    'evidence_strength': 15,
    'future_relevance': 10,
    'rough_feasibility': 10,
}
SCORING_POLICY_VERSION = 'F70-PM-v1'


def observed_evidence(requirement: dict, findings_by_id: dict, selected_records: int) -> dict:
    linked = [findings_by_id[x] for x in requirement.get('linked_finding_ids', []) if x in findings_by_id]
    supporting = {x['source_id'] for x in linked if x.get('evidence_valid')}
    n = len(supporting)
    denominator = max(1, selected_records)
    ratio = n / denominator
    # Transparent batch-level heuristics, not population estimates.
    frequency = 1 if ratio < .01 else 2 if ratio < .03 else 3 if ratio < .08 else 4 if ratio < .15 else 5
    strength = 1 if n <= 1 else 2 if n == 2 else 3 if n <= 4 else 4 if n <= 9 else 5
    return {
        'supporting_source_count': n,
        'selected_batch_size': selected_records,
        'observed_batch_share': round(ratio, 4),
        'auto_ratings': {'customer_frequency': frequency, 'evidence_strength': strength},
        'auto_rating_explanations': {
            'customer_frequency': f'{n} distinct source comments / {selected_records} sampled comments; not a population estimate.',
            'evidence_strength': f'{n} source comments with verbatim quotes; counts alone do not establish independent or representative evidence.',
        },
        # Rough sort index is NOT the final priority score.
        'evidence_triage_signal_0_100': round(100 * (.6 * frequency / 5 + .4 * strength / 5), 1),
        'assumptions': ['Qualitative impact, market fit, future relevance and feasibility still require PM judgment.'],
        'scoring_policy_version': SCORING_POLICY_VERSION,
    }


def assess_priority(observations: dict, ratings: dict, rationales: dict) -> dict:
    """Combine two observed inputs with four explicitly reviewed ratings.

    Allows PM to override observed ratings, but only with a nonblank rationale.
    """
    merged = dict(observations['auto_ratings'])
    explanations = dict(observations['auto_rating_explanations'])
    for factor, rating in ratings.items():
        if factor not in WEIGHTS:
            raise ValueError(f'Unknown scoring factor: {factor}')
        if type(rating) is not int or not 0 <= rating <= 5:
            raise ValueError(f'Rating for {factor} must be integer 0..5')
        why = rationales.get(factor, '')
        if not isinstance(why, str) or not why.strip():
            raise ValueError(f'Rationale required for {factor}')
        merged[factor] = rating
        explanations[factor] = why.strip()
    missing = [key for key in WEIGHTS if key not in merged]
    if missing:
        return {'score': None, 'priority': 'unscored', 'missing_factors': missing,
                'ratings': merged, 'rationales': explanations,
                'status': 'awaiting_pm_assessment', 'policy_version': SCORING_POLICY_VERSION}
    score = round(sum(WEIGHTS[name] * merged[name] / 5 for name in WEIGHTS), 1)
    return {'score': score, 'priority': 'high' if score >= 75 else 'medium' if score >= 50 else 'low',
            'missing_factors': [], 'ratings': merged, 'rationales': explanations,
            'status': 'pm_assessed', 'policy_version': SCORING_POLICY_VERSION}
