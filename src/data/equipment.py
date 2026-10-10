"""Evidence-first equipment candidates and explicit human verification."""
from copy import deepcopy
import re
from .loader import stable_id

AVAILABILITY = {'standard', 'optional', 'included_with_package', 'package-dependent', 'unavailable', 'unknown'}


def equipment_candidates(pages, *, vehicle, market=None):
    """Extract text lines with option codes; never reconstruct table symbols."""
    candidates = []
    for page in pages:
        for line in page.get('text_original', '').splitlines():
            code = re.search(r'\b(?:[0-9][A-Z0-9]{2})\b', line)
            if not code:
                continue
            candidates.append({'record_type': 'vehicle_equipment',
                               'source_id': stable_id('EQUIP', page['source_id'], line),
                               'vehicle_code': vehicle, 'market_scope': market,
                               'feature_name_original': line, 'category': 'Other',
                               'option_code': code.group(), 'availability': 'unknown',
                               'listed_variants': [], 'included_in_package_codes': [],
                               'dependencies': [], 'restrictions': [],
                               'source_catalog_page_id': page['source_id'],
                               'source_page': page['page'], 'source_file': page['source_file'],
                               'source_ref': page['source_ref'], 'source_text_match': line,
                               'verification_status': 'needs_review',
                               'limitations': ['Candidate may be a code or table fragment; visual verification required.']})
    return list({r['source_id']: r for r in candidates}.values())


def verify_equipment(candidate, page, *, actor, rationale, availability, variants=(), packages=(),
                     dependencies=(), restrictions=()):
    if not actor.strip() or not rationale.strip():
        raise ValueError('Named reviewer and visual verification rationale required')
    if candidate['source_catalog_page_id'] != page['source_id'] or not candidate['source_text_match'] or candidate['source_text_match'] not in page['text_original']:
        raise ValueError('Equipment has no matching page evidence')
    if availability not in AVAILABILITY:
        raise ValueError('Invalid availability')
    if availability in {'included_with_package', 'package-dependent'} and not packages:
        raise ValueError('Package membership required')
    from datetime import datetime, timezone
    result = deepcopy(candidate)
    result.update(availability=availability, listed_variants=list(variants),
                  included_in_package_codes=list(packages), dependencies=list(dependencies),
                  restrictions=list(restrictions), verification_status='verified',
                  verification={'actor': actor, 'rationale': rationale,
                                'timestamp': datetime.now(timezone.utc).isoformat()})
    return result
