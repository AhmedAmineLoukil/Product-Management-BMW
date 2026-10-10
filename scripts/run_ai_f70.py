"""F70 Step B runner. Default mode is PREVIEW: no data sent to an external API.

Examples:
 python scripts/run_ai_f70.py --mode preview --country GB --limit 20
 python scripts/run_ai_f70.py --mode simulated --synthetic
 python scripts/run_ai_f70.py --mode live --synthetic
 python scripts/run_ai_f70.py --mode live --country GB --limit 20 --allow-external-data-transfer
"""
from __future__ import annotations
import argparse
import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.ai import run_ai_pipeline
from src.ai.adapter import load_feedback_for_ai, load_reference_inventory
from src.ai.db import DEFAULT_DB, save_run
from src.ai.schemas import ExtractionBatch, FindingExtraction, ClusteringBatch, SemanticCluster, RequirementDraft

SYNTHETIC = [
    {'source_id': 'DEMO-001', 'vehicle': 'F70', 'text': 'The seats hurt during long journeys.',
     'market': 'GB', 'source_type': 'synthetic', 'source_file': 'synthetic fixture', 'source_location': 'line 1'},
    {'source_id': 'DEMO-002', 'vehicle': 'F70', 'text': 'My back aches after sitting in these seats.',
     'market': 'GB', 'source_type': 'synthetic', 'source_file': 'synthetic fixture', 'source_location': 'line 2'},
    {'source_id': 'DEMO-003', 'vehicle': 'F70', 'text': 'Too many menus for basic air conditioning controls.',
     'market': 'GB', 'source_type': 'synthetic', 'source_file': 'synthetic fixture', 'source_location': 'line 3'},
]

class SimulatedClient:
    """Deterministic offline fixture. Never presented as live AI."""
    def __init__(self):
        self.responses = self
    def parse(self, *, text_format, input, **kwargs):
        payload = json.loads(input)
        if text_format is ExtractionBatch:
            phrase = payload['text']
            category = 'Comfort' if 'seat' in phrase.lower() or 'back' in phrase.lower() else 'Usability'
            parsed = ExtractionBatch(findings=[FindingExtraction(
                finding_type='complaint', category=category,
                summary='Seating comfort' if category == 'Comfort' else 'Complex climate controls',
                customer_need='Comfortable journeys' if category == 'Comfort' else 'Easy access to controls',
                evidence_quote=phrase, needs_review=False, uncertainties=[])])
        elif text_format is ClusteringBatch:
            parsed = ClusteringBatch(clusters=[SemanticCluster(
                title=payload[0]['summary'], summary=payload[0]['summary'],
                category=payload[0]['category'], finding_type=payload[0]['finding_type'],
                finding_ids=[f['finding_id'] for f in payload], uncertainty='')])
        elif text_format is RequirementDraft:
            cat = payload['cluster']['category']
            parsed = RequirementDraft(
                description='Improve seating comfort during extended trips.' if cat == 'Comfort' else 'Make frequently used climate settings easier to access.',
                category=cat, rationale='Grounded in the supplied synthetic comments.', confidence='low',
                assumptions=['Synthetic demonstration, not BMW evidence.'],
                uncertainties=['Requires validation with representative customer data.'])
        else:
            raise AssertionError('Unknown schema')
        return SimpleNamespace(output_parsed=parsed, output=[], status='completed')


def write_jsonl(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('w', encoding='utf-8') as f:
        for obj in rows:
            f.write(json.dumps(obj, ensure_ascii=False, allow_nan=False) + '\n')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode', choices=['preview','simulated','live'], default='preview')
    parser.add_argument('--input', default='data/processed/feedback.jsonl')
    parser.add_argument('--country', help='Exact feedback country code e.g. GB, JP, FR')
    parser.add_argument('--limit', type=int, default=20, help='Maximum feedback records; for all use --limit 0')
    parser.add_argument('--seed', type=int, default=42)
    parser.add_argument('--synthetic', action='store_true', help='No BMW records; small simulated feedback')
    parser.add_argument('--allow-external-data-transfer', action='store_true',
                        help='Explicitly confirm organizer approval to send source data to OpenAI API')
    parser.add_argument('--db', default=str(DEFAULT_DB))
    args = parser.parse_args(argv)
    if args.mode == 'simulated' and not args.synthetic:
        parser.error('Simulated mode accepts synthetic data only (prevents fake real-data claims).')
    if args.synthetic:
        records = SYNTHETIC[:args.limit] if args.limit else list(SYNTHETIC)
        stats = {'selected_records': len(records), 'sampling': 'synthetic fixture',
                 'warning': 'SYNTHETIC FEEDBACK, NOT REAL BMW DATA'}
    else:
        limit = None if args.limit == 0 else args.limit
        records, stats = load_feedback_for_ai(ROOT / args.input, country=args.country,
                                               limit=limit, seed=args.seed)
    print('DATASET:', 'SYNTHETIC' if args.synthetic else 'PRIVATE F70')
    print('SELECTION:', json.dumps(stats, ensure_ascii=False))
    print('REFERENCE INVENTORY:', json.dumps(load_reference_inventory(ROOT / 'data/processed')))
    if args.mode == 'preview':
        print('PREVIEW ONLY: no model calls; no data transferred; no database changes.')
        return 0
    if not records:
        print('No eligible records selected. Nothing to process.')
        return 1
    if args.mode == 'live':
        if not args.synthetic and not args.allow_external_data_transfer:
            parser.error('Real BMW data API processing requires explicit --allow-external-data-transfer and organizer approval.')
        from dotenv import load_dotenv
        load_dotenv(ROOT / '.env')
        if not os.getenv('OPENAI_API_KEY'):
            parser.error('Missing OPENAI_API_KEY in environment/.env')
        from openai import OpenAI
        client = OpenAI(timeout=60, max_retries=2)
    else:
        client = SimulatedClient()
    print(f'RUN: {args.mode}; processing {len(records)} distinct source comments.')
    result = run_ai_pipeline(records, client=client)
    run_id = save_run(records, result, db_path=ROOT / args.db, settings={
        'mode': args.mode, 'synthetic': args.synthetic, 'country_filter': args.country,
        'sample_seed': args.seed, 'model': (os.getenv('OPENAI_MODEL','gpt-5-mini') if args.mode == 'live' else 'simulated'),
        'sample_warning': stats.get('warning')})
    out = ROOT / 'data/processed/ai_runs' / run_id
    write_jsonl(out/'findings.jsonl', result['findings'])
    write_jsonl(out/'clusters.jsonl', result['clusters'])
    write_jsonl(out/'requirements_drafts.jsonl', result['proposed_requirements'])
    (out/'run_report.json').write_text(json.dumps({
        'run_id': run_id, 'mode': args.mode, 'synthetic': args.synthetic,
        'selection': stats, 'validation_errors': result['validation_errors'],
        'counts': {'findings': len(result['findings']), 'clusters': len(result['clusters']),
                   'proposals': len(result['proposed_requirements'])},
    }, indent=2, ensure_ascii=False), encoding='utf-8')
    print('RUN ID:', run_id)
    print('RESULT:', {'findings': len(result['findings']), 'clusters': len(result['clusters']),
                      'requirements': len(result['proposed_requirements']),
                      'validation_errors': len(result['validation_errors'])})
    print('PRIVATE OUTPUT:', out.relative_to(ROOT))
    print('NEXT: python scripts/review_f70.py list')
    return 0

if __name__ == '__main__':
    sys.exit(main())
