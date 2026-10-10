"""JSON stdin/stdout bridge. Credentials remain in the server process."""
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.backend.services.analysis_service import analyze_records

if __name__ == '__main__':
    try:
        records = json.load(sys.stdin)
        print(json.dumps(analyze_records(records), ensure_ascii=False))
    except ValueError as exc:
        print(json.dumps({'error': str(exc)}))
        sys.exit(1)
    except Exception:
        print(json.dumps({'error': 'Analysis failed. Check the server Python dependencies and model configuration.'}))
        sys.exit(1)
