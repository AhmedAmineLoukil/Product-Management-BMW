"""JSON stdin/stdout bridge. Credentials remain in the server process."""
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.backend.services.analysis_service import analyze_records
from scripts.bridge_errors import error_response

if __name__ == '__main__':
    try:
        request = json.load(sys.stdin)
        if not isinstance(request, dict):
            raise ValueError('Send a JSON object containing feedback records.')
        print(json.dumps(analyze_records(request.get('records')), ensure_ascii=False))
    except Exception as exc:
        print(json.dumps(error_response(exc, 'Analysis')))
        sys.exit(1)
