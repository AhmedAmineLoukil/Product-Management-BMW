"""Ingest reviewed offline research excerpts; no network or model calls."""
import argparse
import json
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.data.research import ResearchRepository
from src.data.loader import DataRepository, read_records


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--input', required=True, help='JSONL with url, text, claim, vehicle, market, limitations')
    p.add_argument('--allowlist', default='config/research_allowlist.json')
    p.add_argument('--output', default='data/processed/research.jsonl')
    a = p.parse_args()
    repository = ResearchRepository.from_config(a.allowlist)
    records = [repository.ingest_offline(**record) for record in read_records(a.input)]
    path = Path(a.output)
    previous = read_records(path) if path.exists() else []
    # Retrieval times vary, but an identical claim keeps its original provenance.
    seen = {r['source_id'] for r in previous}
    merged = DataRepository(previous).merge(r for r in records if r['source_id'] not in seen)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in merged.records), encoding='utf-8')
    print(json.dumps({'research_records': len(merged.records), 'network_requests': 0}))


if __name__ == '__main__':
    main()
