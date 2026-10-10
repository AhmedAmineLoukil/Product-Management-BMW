"""Bridge between Step A JSONL files and Step B AI model contracts.

Zero network calls. No EU/DE assumptions are derived from language or market name.
"""
from __future__ import annotations
import json
import random
from pathlib import Path
from collections import Counter
from .schemas import FeedbackRecord


def load_jsonl(path: str | Path) -> list[dict]:
    path = Path(path)
    if not path.is_file():
        raise FileNotFoundError(f'Cannot locate {path}. Run Step A ingestion first.')
    records = []
    with path.open('r', encoding='utf-8') as stream:
        for line_number, line in enumerate(stream, 1):
            if not line.strip():
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f'Malformed JSONL at {path.name}:line {line_number}') from exc
            if not isinstance(record, dict):
                raise ValueError(f'Not a JSON object at {path.name}:line {line_number}')
            records.append(record)
    return records


def adapt_feedback(raw: dict) -> dict:
    if raw.get('record_type') != 'customer_feedback' or raw.get('vehicle_code') != 'F70':
        raise ValueError('Expected a normalized F70 customer_feedback record')
    source_id = raw.get('source_id')
    text = raw.get('text_original')
    if not isinstance(source_id, str) or not isinstance(text, str):
        raise ValueError('Source ID/text_original must be strings')
    annotations = raw.get('annotations', [])
    if not isinstance(annotations, list):
        raise ValueError('Annotations must be a list')
    # Preserve categories (weak context), but count the source exactly once.
    label_pairs = sorted({
        (str(a.get('feedback_type') or ''), str(a.get('vfc_level_2') or ''))
        for a in annotations if isinstance(a, dict)
    })
    row_reference = raw.get('source_cell') or f"{raw.get('source_sheet', 'Feedback_Explorer')}!row unknown"
    candidate = {
        'source_id': source_id,
        'vehicle': 'F70',
        'text': text,
        'market': raw.get('country_code') or None,
        'source_type': 'customer_feedback',
        'source_file': raw.get('source_file'),
        'source_location': row_reference,
        'metadata': {
            'feedback_id': raw.get('feedback_id'),
            'engine_type': raw.get('engine_type'),
            'annotation_count': len(annotations),
            'annotation_labels': [{'type': t, 'category': c} for t, c in label_pairs],
            'source_rows': raw.get('source_rows', []),
        },
    }
    return FeedbackRecord.model_validate(candidate).model_dump(exclude_none=True)


def load_feedback_for_ai(path, *, country=None, limit=20, seed=42):
    """Select distinct comments, not annotation rows; reproducible seeded sampling.

    Sampling a subset is NOT representative of a country/population.
    """
    if limit is not None and limit < 1:
        raise ValueError('limit must be positive or None')
    country = country.upper() if country else None
    all_raw = load_jsonl(path)
    selected = []
    seen = set()
    for raw in all_raw:
        entry = adapt_feedback(raw)
        if entry['source_id'] in seen:
            raise ValueError(f"Duplicate normalized source_id: {entry['source_id']}")
        seen.add(entry['source_id'])
        if country and (entry.get('market') or '').upper() != country:
            continue
        if entry['text'].strip():
            selected.append(entry)
    available = len(selected)
    country_counts = dict(Counter(x.get('market') or 'UNKNOWN' for x in selected))
    if limit is not None and limit < len(selected):
        selected = random.Random(seed).sample(selected, limit)
    # Re-sort selected records to keep stable original ordering in the pipeline.
    order = {r['source_id']: i for i, r in enumerate(all_raw)}
    selected.sort(key=lambda r: order[r['source_id']])
    stats = {
        'filter_country': country,
        'available_nonempty_distinct_records': available,
        'selected_records': len(selected),
        'selected_countries': dict(Counter(x.get('market') or 'UNKNOWN' for x in selected)),
        'available_countries': country_counts,
        'sampling': 'all_selected' if limit is None or limit >= available else f'seeded_random_sample(seed={seed})',
        'warning': 'Sample frequencies are not population prevalence. Customer study scope is EU; catalog scope is DE.',
    }
    return selected, stats


def load_reference_inventory(processed_dir: str | Path):
    """Context inventory only. NEVER turns reference metrics into customer quotations."""
    path = Path(processed_dir)
    inventory = {}
    files = {'study_eu': 'study_eu.jsonl', 'sales': 'sales.jsonl',
             'equipment': 'equipment.jsonl', 'catalog': 'catalog_pages.jsonl'}
    for category, filename in files.items():
        full = path / filename
        if not full.is_file():
            inventory[category] = {'available': False, 'records': 0}
            continue
        records = load_jsonl(full)
        scopes = sorted({str(x.get('market_scope') or x.get('country_scope') or x.get('market_code') or '')
                         for x in records if isinstance(x, dict)})
        inventory[category] = {'available': True, 'records': len(records), 'scopes': scopes}
    inventory['warning'] = ('These sources use different markets and methodologies. '
                            'Do not automatically treat reference metrics as supporting an individual requirement.')
    return inventory
