"""Optional tiny API test using SYNTHETIC data; no BMW file ever read."""
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from dotenv import load_dotenv
from src.ai import run_ai_pipeline


def main():
    load_dotenv(ROOT/'.env')
    example = {'source_id':'TEST-001','vehicle':'F70',
               'text':'The seats are uncomfortable during long trips.',
               'market':'GB','source_type':'synthetic',
               'source_file':'synthetic','source_location':'line 1'}
    result = run_ai_pipeline([example])
    print('Findings:',len(result['findings']))
    print('Requirements:',len(result['proposed_requirements']))
    print('Validation errors:', [e['code'] for e in result['validation_errors']])
    print('No auto-approval performed.')

if __name__ == '__main__':
    main()
