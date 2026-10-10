"""JSON stdin/stdout bridge for the public-source collector."""
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.backend.services.collector import collect

if __name__ == '__main__':
    try:
        request = json.load(sys.stdin)
        if not isinstance(request, dict):
            raise ValueError('Send a JSON object containing a source and market.')
        print(json.dumps(collect(request.get('url'), request.get('model_code'), request.get('market')), ensure_ascii=False))
    except ValueError as exc:
        print(json.dumps({'error': str(exc)}))
        sys.exit(1)
    except Exception:
        print(json.dumps({'error': 'Collection failed. The source may be unavailable or unsupported.'}))
        sys.exit(1)
