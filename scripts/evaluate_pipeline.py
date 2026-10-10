"""Evaluate synthetic mock integration or locally reviewed outputs. Never invokes API."""
import argparse
import json
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.ai.evaluation import evaluate
from src.ai.adapter import load_jsonl
from scripts.run_ai_f70 import SYNTHETIC
from scripts.run_pipeline import SyntheticClient
from src.ai.pipeline import run_ai_pipeline


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--run-dir')
    p.add_argument('--labels', help='Local JSONL with source_id, findings and optional need_group; PM reviewed')
    a = p.parse_args()
    if a.run_dir:
        directory = Path(a.run_dir)
        records = load_jsonl(directory / 'sources.jsonl')
        result = {k: load_jsonl(directory / (v + '.jsonl')) for k, v in
                  [('findings', 'findings'), ('clusters', 'clusters'), ('proposed_requirements', 'requirements')]}
        labels = load_jsonl(a.labels) if a.labels else None
    else:
        records = SYNTHETIC
        result = run_ai_pipeline(records, client=SyntheticClient(), stable_identifiers=True)
        labels = [dict(source_id=r['source_id'], need_group='seats' if i < 2 else 'climate', findings=[
            dict(finding_type='complaint', category='Comfort' if i < 2 else 'Usability', evidence_quote=r['text'])])
                  for i, r in enumerate(records)]
    print(json.dumps({'scope': 'local labeled outputs' if a.run_dir else 'synthetic mock integration; developer-authored labels, not live-model accuracy',
                      'metrics': evaluate(records, result, labels)}, indent=2))


if __name__ == '__main__':
    main()
