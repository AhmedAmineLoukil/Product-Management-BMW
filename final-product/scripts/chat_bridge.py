"""JSON stdin/stdout bridge for the local read-only assistant."""
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai.assistant import answer_question
from scripts.bridge_errors import error_response

if __name__ == '__main__':
    try:
        print(json.dumps(answer_question(json.load(sys.stdin)), ensure_ascii=False))
    except Exception as exc:
        print(json.dumps(error_response(exc, 'The assistant')))
        sys.exit(1)
