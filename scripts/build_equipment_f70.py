"""Step A2: turn a locally verified F70 equipment table into structured JSONL.

Requires:
 - data/processed/catalog_pages.jsonl  (produced by ingest_f70.py)
 - data/raw/f70_equipment_curated.csv  (manually curated, private)

The script includes no BMW equipment source data. NEVER commit data/raw or
processed outputs. Manually validate availability against PDF table symbols.
"""
from __future__ import annotations

import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROCESSED = ROOT / 'data' / 'processed'
CURATED = ROOT / 'data' / 'raw' / 'f70_equipment_curated.csv'
CATALOG_PAGES = PROCESSED / 'catalog_pages.jsonl'
OUTPUT = PROCESSED / 'equipment.jsonl'
VALID_AVAILABILITY = {'standard', 'optional', 'included_with_package', 'unknown'}


def load_catalog() -> dict[int, dict]:
    if not CATALOG_PAGES.exists():
        raise FileNotFoundError('Run: python scripts/ingest_f70.py first')
    with CATALOG_PAGES.open(encoding='utf-8') as f:
        pages = [json.loads(line) for line in f if line.strip()]
    return {int(page['page']): page for page in pages}


def main() -> None:
    pages = load_catalog()
    if not CURATED.exists():
        raise FileNotFoundError(f'Missing private curated CSV: {CURATED}')
    with CURATED.open('r', encoding='utf-8-sig', newline='') as f:
        rows = list(csv.DictReader(f))
    if not rows:
        raise ValueError('Curated CSV contains no equipment features')

    records, seen = [], set()
    for index, row in enumerate(rows, start=1):
        page_number = int(row['page'])
        source = pages.get(page_number)
        if source is None:
            raise ValueError(f'Catalog page {page_number} not found')
        expected_text = row['source_text_match'].strip()
        if not expected_text or expected_text not in source['text_original']:
            raise ValueError(f"Row {index}: source text {expected_text!r} not found on PDF page {page_number}")
        feature_name = row['feature_name_original'].strip()
        if feature_name in seen:
            raise ValueError(f'Repeated feature: {feature_name}')
        seen.add(feature_name)
        availability = row['availability'].strip()
        if availability not in VALID_AVAILABILITY:
            raise ValueError(f'Row {index}: bad availability {availability!r}')
        package_codes = [x.strip() for x in row['package_codes'].split('|') if x.strip()]
        if availability == 'included_with_package' and not package_codes:
            raise ValueError(f'Row {index}: package component missing package_codes')
        variants = [x.strip() for x in row['listed_variants'].split('|') if x.strip()]
        records.append({
            'record_type': 'vehicle_equipment',
            'source_id': f'F70-EQUIP-{index:03d}',
            'vehicle_code': 'F70',
            'market_scope': 'DE',  # PDF is German-market catalog, not EU-wide
            'catalog_edition': '2026-05-28',
            'feature_name_original': feature_name,
            'feature_name_en': row['feature_name_en'].strip(),
            'category': row['category'].strip(),
            'availability': availability,
            'listed_variants': variants,
            'option_code': row['option_code'].strip() or None,
            'included_in_package_codes': package_codes,
            'source_catalog_page_id': source['source_id'],
            'source_file': 'F70_OptionList.PDF',
            'source_page': page_number,
            'source_ref': f'F70_OptionList.PDF#page={page_number}',
            'source_text_match': expected_text,
            'verification_status': row['verification_status'].strip() or 'needs_review',
            'limitations': 'Use catalog for German market only; option and package restrictions require visual validation.',
        })

    PROCESSED.mkdir(parents=True, exist_ok=True)
    with OUTPUT.open('w', encoding='utf-8', newline='\n') as f:
        for record in records:
            f.write(json.dumps(record, ensure_ascii=False, allow_nan=False) + '\n')
    print(f'[OK] {OUTPUT.relative_to(ROOT)}: {len(records)} equipment records')
    print('[REMINDER] Verify German PDF table symbols and conditions; do not share raw/processed files on GitHub.')


if __name__ == '__main__':
    main()
