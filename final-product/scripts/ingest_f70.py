"""BMW F70 dataset normalization, with traceable cell/page references.

Inputs are read from local data/raw/ only. No calls to external services.
Outputs contain BMW-provided data and must NOT be committed to Git.
"""
from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import json
import re

import fitz  # PyMuPDF
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'data' / 'raw'
OUT = ROOT / 'data' / 'processed'

FEEDBACK_FILE = 'F70_feedback_hackathon.xlsx'
STUDY_FILE = 'F70_G60_G68_G70_customer_studies.xlsx'
SALES_FILE = 'sales_volumes.xlsx'
CATALOG_FILE = 'F70_OptionList.PDF'


def required_file(name: str) -> Path:
    path = RAW / name
    if not path.is_file():
        raise FileNotFoundError(f'Missing {path}. Put the original BMW file in data/raw/.')
    return path


def clean(value: object) -> str:
    if pd.isna(value):
        return ''
    return str(value).strip()


def write_jsonl(filename: str, records: list[dict]) -> None:
    path = OUT / filename
    with path.open('w', encoding='utf-8', newline='\n') as f:
        for record in records:
            f.write(json.dumps(record, ensure_ascii=False, allow_nan=False) + '\n')
    print(f'[OK] {path.relative_to(ROOT)}: {len(records)} records')


def file_digest(path: Path) -> str:
    h = sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def read_feedback() -> tuple[list[dict], dict]:
    df = pd.read_excel(required_file(FEEDBACK_FILE), sheet_name='Feedback_Explorer', dtype=str, keep_default_na=False)
    expected = ['ID','Source','Brand','Sales Description','Country','Derivate (e-code)',
                'Engine Type','Feedback Type','Customer Feedback',
                'Vfc level2 3 Name','Vfc level2 Name','Vfc level3 Name']
    if list(df.columns) != expected:
        raise ValueError(f'Unexpected feedback headers. Got: {list(df.columns)}')

    by_id: dict[str, dict] = {}
    for row_number, values in enumerate(df.itertuples(index=False, name=None), start=2):
        cells = dict(zip(expected, values))
        feedback_id = clean(cells['ID'])
        if not feedback_id:
            raise ValueError(f'Missing feedback ID in Excel row {row_number}')
        text = clean(cells['Customer Feedback'])
        country = clean(cells['Country'])
        derivative = clean(cells['Derivate (e-code)'])
        if derivative != 'F70':
            raise ValueError(f'Unexpected derivative {derivative} for {feedback_id}')
        entry = by_id.get(feedback_id)
        if entry is None:
            entry = {
                'record_type': 'customer_feedback',
                'source_id': f'F70-FEEDBACK-{feedback_id}',
                'feedback_id': feedback_id,
                'vehicle_code': derivative,
                'vehicle_name': 'BMW 1 Series',
                'country_code': country,  # DO NOT automatically replace by EU/DE
                'engine_type': clean(cells['Engine Type']),
                'source_group': clean(cells['Source']),
                'text_original': text,
                'source_file': FEEDBACK_FILE,
                'source_sheet': 'Feedback_Explorer',
                'source_cell': f'Feedback_Explorer!I{row_number}',
                'source_rows': [],
                'annotations': [],
            }
            by_id[feedback_id] = entry
        else:
            if entry['text_original'] != text or entry['country_code'] != country or entry['engine_type'] != clean(cells['Engine Type']):
                raise ValueError(f'ID {feedback_id} has inconsistent text/country/engine across rows. Investigate before merging.')
        entry['source_rows'].append(row_number)
        entry['annotations'].append({
            'source_row': row_number,
            'source_ref': f'{FEEDBACK_FILE}#Feedback_Explorer!A{row_number}:L{row_number}',
            'feedback_type': clean(cells['Feedback Type']) or None,
            'vfc_level_2_3': clean(cells['Vfc level2 3 Name']) or None,
            'vfc_level_2': clean(cells['Vfc level2 Name']) or None,
            'vfc_level_3': clean(cells['Vfc level3 Name']) or None,
            'has_classification': clean(cells['Vfc level2 Name']) not in ('', 'no_class_found'),
        })

    records = list(by_id.values())
    countries = Counter(r['country_code'] for r in records)
    stats = {
        'raw_feedback_rows': len(df),
        'unique_feedback_comments': len(records),
        'duplicate_classification_rows': len(df) - len(records),
        'unique_comments_by_country': dict(sorted(countries.items())),
        'countries_have_Germany_DE': 'DE' in countries,
    }
    return records, stats


def read_eu_f70_study() -> list[dict]:
    df = pd.read_excel(required_file(STUDY_FILE), sheet_name='CN_EU_2025', header=None)
    if clean(df.iat[2, 3]) != 'BMW 1 Series F70':
        raise ValueError('Expected F70 study in column D (Excel D3). Confirm workbook structure.')
    results = []
    # Every pair of rows is metric label followed by a Mean rating.
    # Excel row 3 starts first metric; Excel row 4 has its corresponding value.
    for label_idx in range(2, len(df) - 1, 2):
        metric = clean(df.iat[label_idx, 0])
        measure = clean(df.iat[label_idx + 1, 0])
        raw_value = df.iat[label_idx + 1, 3]
        if not metric or measure != 'Mean':
            raise ValueError(f'Unexpected F70 study structure near Excel row {label_idx + 1}')
        if pd.isna(raw_value):
            raise ValueError(f'Missing F70 rating for {metric}')
        excel_value_row = label_idx + 2
        results.append({
            'record_type': 'customer_study_metric',
            'source_id': f'F70-STUDY-EU-{excel_value_row:03d}',
            'vehicle_code': 'F70',
            'market_scope': 'EU',  # NOT Germany-specific
            'study_year': 2025,
            'metric': metric,
            'statistic': 'Mean',
            'value': float(raw_value),
            'scale': None,  # Not specified in supplied sheet
            'sample_size': None,  # Not specified in supplied sheet
            'source_file': STUDY_FILE,
            'source_sheet': 'CN_EU_2025',
            'source_cell': f'CN_EU_2025!D{excel_value_row}',
            'metric_label_cell': f'CN_EU_2025!A{label_idx + 1}',
        })
    return results


def read_f70_sales() -> list[dict]:
    df = pd.read_excel(required_file(SALES_FILE), sheet_name='F70')
    expected = {'market', 'market_code', 'volume_2024','volume_2025','volume_2030'}
    if set(df.columns) != expected:
        raise ValueError(f'Unexpected sales columns: {list(df.columns)}')
    results = []
    for idx, row in df.iterrows():
        excel_row = int(idx) + 2
        market_name = clean(row['market'])
        market_code = clean(row['market_code'])
        for year in (2024, 2025, 2030):
            column = {2024: 'C', 2025: 'D', 2030: 'E'}[year]
            volume = row[f'volume_{year}']
            if pd.isna(volume):
                raise ValueError(f'Missing {year} volume at Excel row {excel_row}')
            results.append({
                'record_type': 'sales_volume',
                'source_id': f'F70-SALES-{market_code}-{year}',
                'vehicle_code': 'F70',
                'market_name': market_name,
                'market_code': market_code,
                'year': year,
                'volume': int(volume),
                'volume_unit': 'vehicles',
                'value_class': 'future_value_unspecified' if year > 2026 else 'historical_value',
                # 2030 should NOT silently be treated as verified realized sales.
                'source_file': SALES_FILE,
                'source_sheet': 'F70',
                'source_cell': f'F70!{column}{excel_row}',
            })
    return results


def catalog_section(page_number: int) -> str:
    if page_number in (5, 6, 7): return 'selected_standard_equipment'
    if page_number in (8, 9, 10, 11): return 'equipment_packages_and_m135'
    if page_number in (13, 14, 15): return 'wheels_colors_materials'
    if page_number in (16, 17, 18): return 'optional_equipment'
    if page_number == 20: return 'technical_reference_out_of_scope'
    return 'other_catalog_content'


def read_catalog() -> list[dict]:
    pdf = fitz.open(required_file(CATALOG_FILE))
    try:
        pages = []
        for i, page in enumerate(pdf, start=1):
            text = page.get_text('text')
            pages.append({
                'record_type': 'equipment_catalog_page',
                'source_id': f'F70-CATALOG-P{i:02d}',
                'vehicle_code': 'F70',
                'country_scope': 'DE',  # German-language BMW.de catalog; other markets require validation.
                'language': 'de',
                'document_edition': '2026-05-28',
                'page': i,
                'section': catalog_section(i),
                'relevant_to_product_requirements': i in set(range(5, 12)) | set(range(13, 19)),
                'text_original': text,
                'source_file': CATALOG_FILE,
                'source_ref': f'{CATALOG_FILE}#page={i}',
                'extraction_warning': 'Flattened PDF text: do not infer per-trim availability from symbol position without visual/manual verification.'
            })
        return pages
    finally:
        pdf.close()


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name in (FEEDBACK_FILE, STUDY_FILE, SALES_FILE, CATALOG_FILE):
        required_file(name)
    feedback, stats = read_feedback()
    study = read_eu_f70_study()
    sales = read_f70_sales()
    catalog = read_catalog()
    write_jsonl('feedback.jsonl', feedback)
    write_jsonl('study_eu.jsonl', study)
    write_jsonl('sales.jsonl', sales)
    write_jsonl('catalog_pages.jsonl', catalog)

    summary = {
        'processor_version': 'f70-mvp-v1',
        'created_at_utc': datetime.now(timezone.utc).isoformat(),
        'vehicle': 'F70',
        'counts': {
            'feedback': len(feedback), 'study_eu_metrics': len(study),
            'sales_records': len(sales), 'catalog_pages': len(catalog)
        },
        'feedback_details': stats,
        'market_scope_caveat': 'Feedback country codes, EU-wide study, European-region sales, and DE-market catalog are different scopes. Never claim they all represent Germany.',
        'inputs_sha256': {name: file_digest(required_file(name)) for name in (FEEDBACK_FILE,STUDY_FILE,SALES_FILE,CATALOG_FILE)}
    }
    (OUT/'manifest.json').write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding='utf-8')
    print('[OK] Manifest created. IMPORTANT: data/processed/ is confidential and Git-ignored.')
    print('COUNTS', summary['counts'])
    print('COUNTRY DISTRIBUTION', stats['unique_comments_by_country'])

if __name__ == '__main__':
    main()
