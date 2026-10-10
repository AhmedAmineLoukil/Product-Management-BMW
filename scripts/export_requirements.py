"""Export a PM-reviewed local requirement portfolio. Outputs are PRIVATE."""
import argparse
import csv
import json
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from src.ai.db import list_requirements, DEFAULT_DB

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--db',default=str(DEFAULT_DB))
    p.add_argument('--output',default='data/processed/requirement_portfolio.csv')
    a=p.parse_args()
    requirements=list_requirements(ROOT/a.db)
    destination=ROOT/a.output
    destination.parent.mkdir(parents=True,exist_ok=True)
    cols=['requirement_id','vehicle_code','description','category','status','version',
          'priority_score','priority_level','evidence_level','linked_finding_ids','linked_source_ids',
          'assumptions','uncertainties','scoring_rationale','priority_factor_details']
    with destination.open('w',encoding='utf-8-sig',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=cols)
        writer.writeheader()
        for req in requirements:
            assessment=req.get('priority_assessment',{})
            row={k:req.get(k) for k in cols}
            row['priority_score']=assessment.get('score')
            row['priority_level']=assessment.get('priority')
            row['priority_factor_details']=assessment
            for field in ['linked_finding_ids','linked_source_ids','assumptions','uncertainties','priority_factor_details']:
                row[field]=json.dumps(row[field],ensure_ascii=False)
            writer.writerow(row)
    print(f'Exported {len(requirements)} private requirements to {destination}')

if __name__=='__main__': main()
