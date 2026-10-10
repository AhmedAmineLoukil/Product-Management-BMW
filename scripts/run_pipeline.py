"""Unified preview/synthetic/live runner. Outputs are local and private."""
import argparse
import json
import sys
import time
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.data.loader import DataRepository, read_records, normalize_feedback
from src.ai.adapter import adapt_feedback
from src.ai.pipeline import run_ai_pipeline
from src.ai.provenance import validate_graph
from src.ai.db import save_run
from scripts.run_ai_f70 import SYNTHETIC, SimulatedClient, write_jsonl
from src.ai.schemas import MultiExtractionBatch, RecordFindings, ExtractionBatch
from types import SimpleNamespace


class SyntheticClient(SimulatedClient):
    def parse(self, *, text_format, input, **kwargs):
        if text_format is MultiExtractionBatch:
            records = json.loads(input)['records']
            parsed = MultiExtractionBatch(records=[RecordFindings(source_id=r['source_id'], findings=
                super(SyntheticClient, self).parse(text_format=ExtractionBatch, input=json.dumps(r), **kwargs).output_parsed.findings)
                for r in records])
            return SimpleNamespace(output_parsed=parsed, status='completed', output=[])
        return super().parse(text_format=text_format, input=input, **kwargs)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--mode', choices=['preview', 'synthetic', 'live'], default='preview')
    p.add_argument('--vehicle', choices=['F70', 'G60', 'G70'], default='F70')
    p.add_argument('--country', '--market', dest='market')
    p.add_argument('--input', default='data/processed/feedback.jsonl')
    p.add_argument('--references', help='Directory of normalized reference JSONL files')
    p.add_argument('--limit', type=int, default=20)
    p.add_argument('--batch-size', type=int, default=1)
    p.add_argument('--model')
    p.add_argument('--output-dir', default='data/processed/pipeline')
    p.add_argument('--db', help='Optional SQLite integration; existing dashboard can read this database')
    p.add_argument('--allow-external-data-transfer', action='store_true')
    a = p.parse_args(argv)
    if a.limit < 1 or a.batch_size < 1:
        p.error('limit and batch-size must be positive')
    if a.mode == 'live' and not a.allow_external_data_transfer:
        p.error('Live BMW processing requires explicit --allow-external-data-transfer authorization')
    start = time.perf_counter()
    if a.mode == 'synthetic':
        records = [dict(r, vehicle=a.vehicle) for r in SYNTHETIC]
        if a.market:
            records = [r for r in records if r['market'] == a.market.upper()]
        records = records[:a.limit]
        quality = {'synthetic': True, 'distinct_feedback_records': len(records)}
    else:
        raw = read_records(a.input)
        normalized = normalize_feedback(raw, vehicle=a.vehicle)
        repo = DataRepository(normalized)
        records = [adapt_feedback(r) for r in repo.load_feedback(a.vehicle, a.market)[:a.limit]]
        quality = repo.generate_data_quality_report(a.vehicle)
    references = []
    if a.references:
        references = [r for r in DataRepository.from_directory(a.references).records
                      if r['record_type'] != 'customer_feedback']
    out = Path(a.output_dir)
    out.mkdir(parents=True, exist_ok=True)
    if a.mode == 'preview':
        report = {'mode': 'preview', 'quality': quality, 'selected_records': len(records), 'api_requests': 0}
        (out / 'validation_report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
        print(json.dumps(report))
        return 0
    if a.mode == 'synthetic':
        client = SyntheticClient()
    else:
        from dotenv import load_dotenv
        load_dotenv(ROOT / '.env')
        from src.ai.client import authorized_client
        client = authorized_client(allow_external_data_transfer=True, model=a.model,
                                   cache_dir=out / 'cache')
    result = run_ai_pipeline(records, client=client, references=references,
                             batch_size=a.batch_size, stable_identifiers=True)
    graph_errors = validate_graph(records + references, result)
    report = {'mode': a.mode, 'quality': quality, 'selected_records': len(records),
              'validation_errors': result['validation_errors'], 'graph_errors': graph_errors,
              'processing_seconds': round(time.perf_counter() - start, 4),
              'usage': client.usage if hasattr(client, 'usage') else {'requests': 0, 'estimated_cost_usd': 0},
              'evidence_validation_rate': sum(f['evidence_valid'] for f in result['findings']) / len(result['findings']) if result['findings'] else None,
              'unsupported_requirement_count': sum(r['evidence_level'] == 'unsupported' for r in result['proposed_requirements'])}
    for key, filename in [('findings', 'findings'), ('clusters', 'clusters'), ('proposed_requirements', 'requirements'),
                          ('evidence_links', 'evidence_links'), ('conflicts', 'conflicts')]:
        write_jsonl(out / (filename + '.jsonl'), result[key])
    write_jsonl(out / 'sources.jsonl', records + references)
    (out / 'validation_report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    if a.db:
        save_run(records + references, result, db_path=a.db,
                 settings={'vehicle': a.vehicle, 'market': a.market, 'mode': a.mode, 'model': a.model or 'configured'},
                 metrics=report)
    print(json.dumps({'findings': len(result['findings']), 'clusters': len(result['clusters']),
                      'requirements': len(result['proposed_requirements']), 'graph_errors': len(graph_errors), 'output_dir': str(out)}))
    return 1 if graph_errors or result['validation_errors'] else 0


if __name__ == '__main__':
    sys.exit(main())
