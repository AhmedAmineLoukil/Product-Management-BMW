"""Offline multi-vehicle ingestion. No confidential contents are logged."""
import argparse
import json
import re
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.data.loader import read_records, normalize_feedback, DataRepository, stable_id
from src.data.equipment import equipment_candidates


def normalize_tabular(rows, kind, vehicle, market=None):
    output = []
    for raw in rows:
        row = dict(raw)
        sheet_vehicle = re.search(r'\b(F70|G60|G70)\b', str(row.get('source_sheet') or ''))
        code = row.get('vehicle_code') or row.get('vehicle') or (sheet_vehicle.group() if sheet_vehicle else vehicle)
        if not code:
            raise ValueError('Vehicle required for reference records')
        row.update(record_type=kind, vehicle_code=code)
        if market and not DataRepository.market(row):
            row['market_scope'] = market
        row['source_ref'] = row.get('source_ref') or f"{row.get('source_file')}#{row.get('source_sheet')}!row={row.get('source_row')}"
        row['source_id'] = row.get('source_id') or stable_id('SOURCE', kind, row)
        if kind == 'sales_volume':
            year_columns = [k for k in row if k.startswith('volume_') and k[7:].isdigit()]
            for key in year_columns:
                if row[key] in (None, ''):
                    continue
                item = dict(row, year=int(key[7:]), volume=float(row[key]),
                            source_cell=row.get('source_cells', {}).get(key),
                            source_id=stable_id('SALES', row['source_id'], key),
                            value_class='future_value_unspecified')
                output.append(item)
            if year_columns:
                continue
        output.append(row)
    return output


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--input', required=True)
    p.add_argument('--vehicle', choices=['F70', 'G60', 'G70'])
    p.add_argument('--market')
    p.add_argument('--kind', choices=['feedback', 'equipment', 'study', 'sales'], required=True)
    p.add_argument('--output', default='data/processed/imported.jsonl')
    p.add_argument('--study-layout', choices=['tabular', 'bmw-wide'], default='tabular')
    a = p.parse_args(argv)
    raw = [] if a.kind == 'study' and a.study_layout == 'bmw-wide' else read_records(a.input)
    if a.kind == 'study' and a.study_layout == 'bmw-wide':
        from src.data.studies import read_bmw_studies
        records = read_bmw_studies(a.input, market=a.market,
                                   vehicles=[a.vehicle] if a.vehicle else ['F70', 'G60', 'G70'])
    elif a.kind == 'feedback':
        records = normalize_feedback(raw, vehicle=a.vehicle)
    elif Path(a.input).suffix.lower() == '.pdf':
        if not a.vehicle:
            p.error('PDF equipment requires --vehicle')
        for page in raw:
            page.update(vehicle_code=a.vehicle, country_scope=a.market)
        records = raw + equipment_candidates(raw, vehicle=a.vehicle, market=a.market)
    else:
        records = normalize_tabular(raw, {'equipment': 'vehicle_equipment', 'study': 'customer_study_metric',
                                          'sales': 'sales_volume'}[a.kind], a.vehicle, a.market)
    if a.vehicle:
        records = [r for r in records if r.get('vehicle_code') == a.vehicle]
    out = Path(a.output)
    existing = read_records(out) if out.exists() else []
    merged = DataRepository(existing).merge(records)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(''.join(json.dumps(r, ensure_ascii=False, allow_nan=False) + '\n' for r in merged.records), encoding='utf-8')
    print(json.dumps({'records': len(merged.records), 'vehicles': merged.get_available_vehicles(),
                      'quality': [merged.generate_data_quality_report(v) for v in merged.get_available_vehicles()]}))


if __name__ == '__main__':
    main()
