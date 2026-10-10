"""Reusable heterogeneous loading with conservative, lossless normalization."""
from __future__ import annotations
from collections import Counter
from datetime import date, datetime
from hashlib import sha256
from pathlib import Path
import json
import math
import re


def stable_id(kind, *parts):
    body = json.dumps(parts, sort_keys=True, ensure_ascii=False, default=str)
    return f'{kind}-{sha256(body.encode()).hexdigest()[:24]}'


def column_name(value):
    return re.sub(r'[^a-z0-9]+', '_', str(value).strip().lower()).strip('_')


def clean_value(value):
    if value is None or isinstance(value, float) and math.isnan(value):
        return None
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if hasattr(value, 'item'):
        return clean_value(value.item())
    return value  # Customer text is deliberately never stripped or translated.


def read_records(path):
    """Read all sheets or PDF pages; preserve source cells and original headers.

    Wide/presentation-style study sheets require their explicit domain adapter;
    this reader retains every cell rather than guessing metric semantics.
    """
    path = Path(path)
    suffix = path.suffix.lower()
    if suffix == '.jsonl':
        from src.ai.adapter import load_jsonl
        return load_jsonl(path)
    if suffix == '.pdf':
        import pymupdf
        with pymupdf.open(path) as doc:
            return [{'record_type': 'equipment_catalog_page',
                     'source_id': stable_id('PAGE', path.name, i),
                     'source_file': path.name, 'page': i,
                     'source_ref': f'{path.name}#page={i}',
                     'text_original': page.get_text('text'),
                     'verification_status': 'needs_review',
                     'limitations': ['Flattened text does not establish table availability.']}
                    for i, page in enumerate(doc, 1)]
    if suffix not in {'.csv', '.xlsx', '.xls'}:
        raise ValueError('Supported formats: CSV, XLSX, XLS, JSONL, text-based PDF')
    import pandas as pd
    from openpyxl.utils import get_column_letter
    sheets = {'CSV': pd.read_csv(path, dtype=object, keep_default_na=False)} if suffix == '.csv' else pd.read_excel(
        path, sheet_name=None, dtype=object, keep_default_na=False)
    records = []
    for sheet, frame in sheets.items():
        headers = [column_name(x) for x in frame.columns]
        if len(set(headers)) != len(headers):
            raise ValueError('Ambiguous normalized column names')
        for row_number, values in enumerate(frame.itertuples(index=False, name=None), 2):
            record = dict(zip(headers, map(clean_value, values)))
            record.update(source_file=path.name, source_sheet=sheet, source_row=row_number,
                          source_cells={h: f'{sheet}!{get_column_letter(i)}{row_number}'
                                        for i, h in enumerate(headers, 1)},
                          original_columns=dict(zip(headers, map(str, frame.columns))))
            records.append(record)
    return records


def normalize_feedback(rows, *, vehicle=None):
    """Collapse annotation rows by actual comment identity, never by text alone.

    Conflicting versions of an ID are retained separately and flagged. Identical
    text from different customer IDs remains separate customer evidence.
    """
    output = {}
    identities = {}
    for ordinal, raw in enumerate(rows):
        def get(*keys):
            return next((raw[k] for k in keys if raw.get(k) not in (None, '')), None)
        text = get('text_original', 'customer_feedback', 'feedback', 'text')
        if text is None:
            text = ''
        text = str(text)
        code = get('vehicle_code', 'derivate_e_code', 'derivative', 'vehicle') or vehicle
        if not code:
            raise ValueError('Vehicle must be supplied or present in each feedback row')
        country = get('country_code', 'country', 'market')
        country = str(country).upper().strip() if country else None
        fid = get('feedback_id', 'id')
        origin = (raw.get('source_file'), raw.get('source_sheet'))
        identity = (code, origin, fid) if fid is not None else (
            code, origin, raw.get('source_row'), raw.get('source_id') or ('unlocated', ordinal))
        signature = (text, country, get('engine_type'), get('sales_description'))
        key = (identity, signature)
        previous = identities.setdefault(identity, set())
        previous.add(signature)
        if key not in output:
            output[key] = {
                'record_type': 'customer_feedback', 'vehicle_code': code,
                'source_id': raw.get('source_id') or stable_id('FEEDBACK', identity, signature),
                'feedback_id': fid, 'country_code': country, 'text_original': text,
                'engine_type': get('engine_type'), 'derivative': get('sales_description'),
                'source_file': raw.get('source_file'), 'source_sheet': raw.get('source_sheet'),
                'source_cell': raw.get('source_cell') or raw.get('source_cells', {}).get('customer_feedback'),
                'source_rows': [], 'annotations': [], 'original_rows': [], 'quality_issues': [],
            }
        item = output[key]
        for number in raw.get('source_rows', [raw.get('source_row')]):
            if number is not None and number not in item['source_rows']:
                item['source_rows'].append(number)
        annotations = raw.get('annotations') or [{k: v for k, v in raw.items()
                                                if k.startswith(('feedback_type', 'vfc_'))}]
        for annotation in annotations:
            if annotation and annotation not in item['annotations']:
                item['annotations'].append(annotation)
        if raw not in item['original_rows']:
            item['original_rows'].append(raw)
    for (identity, _), item in output.items():
        if len(identities[identity]) > 1:
            item['quality_issues'].append('conflicting_feedback_identity')
        if not item['text_original'].strip():
            item['quality_issues'].append('missing_feedback_text')
    # Detect reused IDs instead of silently replacing records.
    ids = [x['source_id'] for x in output.values()]
    if len(ids) != len(set(ids)):
        raise ValueError('Duplicate source IDs with incompatible records')
    return list(output.values())


class DataRepository:
    """An explicit local repository over normalized records, including legacy F70 outputs."""
    def __init__(self, records=()):
        self.records = list(records)
        ids = [r.get('source_id') for r in self.records]
        if any(not x for x in ids) or len(ids) != len(set(ids)):
            raise ValueError('All sources need unique nonempty IDs')

    @classmethod
    def from_directory(cls, directory):
        records = []
        for path in sorted(Path(directory).glob('*.jsonl')):
            for row in read_records(path):
                if row.get('record_type'):
                    records.append(row)
        return cls(records)

    def select(self, kind, vehicle, market=None, derivative=None):
        return [r for r in self.records if r.get('record_type') == kind
                and r.get('vehicle_code', r.get('vehicle')) == vehicle
                and (market is None or self.market(r) == market.upper())
                and (derivative is None or r.get('derivative', r.get('engine_type')) == derivative)]

    @staticmethod
    def market(record):
        return record.get('country_code') or record.get('market_scope') or record.get('market_code') or record.get('country_scope') or record.get('market')

    def load_feedback(self, vehicle, country=None, derivative=None):
        return self.select('customer_feedback', vehicle, country, derivative)

    def load_equipment(self, vehicle, market=None):
        return self.select('vehicle_equipment', vehicle, market)

    def load_customer_studies(self, vehicle, market=None):
        return self.select('customer_study_metric', vehicle, market)

    def load_sales(self, vehicle, market=None):
        return self.select('sales_volume', vehicle, market)

    def get_available_vehicles(self):
        return sorted({r.get('vehicle_code', r.get('vehicle')) for r in self.records
                       if r.get('vehicle_code', r.get('vehicle'))})

    def get_available_markets(self, vehicle):
        return sorted({self.market(r) for r in self.records
                       if r.get('vehicle_code', r.get('vehicle')) == vehicle and self.market(r)})

    def generate_data_quality_report(self, vehicle):
        rows = self.load_feedback(vehicle)
        return {'vehicle': vehicle, 'distinct_feedback_records': len(rows),
                'classification_rows': sum(len(r.get('annotations', [])) for r in rows),
                'missing_text': sum(not r.get('text_original', '').strip() for r in rows),
                'missing_location': sum(not (r.get('source_cell') or r.get('source_ref')) for r in rows),
                'markets': dict(Counter(self.market(r) or 'UNKNOWN' for r in rows)),
                'quality_issues': dict(Counter(i for r in rows for i in r.get('quality_issues', [])))}

    def merge(self, records):
        by_id = {r['source_id']: r for r in self.records}
        for record in records:
            sid = record['source_id']
            if sid in by_id and by_id[sid] != record:
                raise ValueError('Existing source ID has changed content; review before replacement')
            by_id[sid] = record
        return DataRepository(by_id.values())
