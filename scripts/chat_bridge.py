"""JSON stdin/stdout bridge for the local read-only assistant."""
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai.assistant import answer_question

if __name__ == '__main__':
    try:
        print(json.dumps(answer_question(json.load(sys.stdin)), ensure_ascii=False))
    except ValueError as exc:
        print(json.dumps({'error': str(exc)}))
        sys.exit(1)
    except Exception:
        print(json.dumps({'error': 'The assistant is temporarily unavailable. Try again.'}))
        sys.exit(1)
