"""Export a PM-reviewed local requirement portfolio. Outputs are PRIVATE."""
import argparse
import csv
import json
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from src.ai.db import list_requirements, DEFAULT_DB
from src.copilot import portfolio_export

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--db',default=str(DEFAULT_DB))
    p.add_argument('--output',default='data/processed/requirement_portfolio.csv')
    p.add_argument('--actor', required=True, help='Named unauthenticated demo PM for export audit')
    a=p.parse_args()
    requirements=list_requirements(ROOT/a.db)
    destination=ROOT/a.output
    destination = destination.resolve()
    if not any(destination.is_relative_to((ROOT/folder).resolve()) for folder in ('data', 'exports')):
        p.error('Confidential exports must stay inside ignored data/ or exports/ directories')
    destination.parent.mkdir(parents=True,exist_ok=True)
    if destination.suffix not in ('.csv', '.json'):
        p.error('Output must end in .csv or .json')
    destination.write_text(portfolio_export(ROOT/a.db, requirements, a.actor,
                                            destination.suffix[1:]), encoding='utf-8')
    print(f'Exported {len(requirements)} private requirements to {destination}')

if __name__=='__main__': main()
