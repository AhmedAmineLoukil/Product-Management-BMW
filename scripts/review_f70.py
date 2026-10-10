"""Simple PM CLI. All changes persist with actor/time/reason in SQLite audit."""
import argparse
import json
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.ai.db import (DEFAULT_DB, list_requirements, get_requirement,
                       get_linked_evidence, audit_history, revise_requirement)
from src.ai.scoring import WEIGHTS


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--db', default=str(DEFAULT_DB))
    sub = p.add_subparsers(dest='command', required=True)
    sub.add_parser('list')
    for name in ('show', 'evidence', 'audit'):
        sp = sub.add_parser(name)
        sp.add_argument('id')
    sp = sub.add_parser('action')
    sp.add_argument('id')
    sp.add_argument('--actor', required=True)
    sp.add_argument('--type', required=True, choices=['approve','reject','postpone','challenge','edit','score'])
    sp.add_argument('--reason', required=True)
    sp.add_argument('--description', help='New requirement description for edit')
    sp.add_argument('--ratings', help='JSON object with human factor ratings 0..5')
    sp.add_argument('--rationales', help='JSON object with explanation for each human factor rating')
    a = p.parse_args(argv)
    try:
        if a.command == 'list':
            reqs = list_requirements(ROOT/a.db)
            for req in reqs:
                score = req.get('priority_assessment', {}).get('score')
                print(f"{req['requirement_id']} | {req['status']} | score={score} | {req['description']}")
            if not reqs:
                print('No saved requirements. Run the Step B pipeline first.')
        elif a.command == 'show':
            print(json.dumps(get_requirement(a.id, ROOT/a.db), indent=2, ensure_ascii=False))
        elif a.command == 'evidence':
            print(json.dumps(get_linked_evidence(a.id, ROOT/a.db), indent=2, ensure_ascii=False))
        elif a.command == 'audit':
            print(json.dumps(audit_history(a.id, ROOT/a.db), indent=2, ensure_ascii=False))
        elif a.command == 'action':
            changed = revise_requirement(a.id, actor=a.actor, action=a.type,
                                          rationale=a.reason, description=a.description,
                                          ratings=json.loads(a.ratings) if a.ratings else None,
                                          score_rationales=json.loads(a.rationales) if a.rationales else None,
                                          db_path=ROOT/a.db)
            print(f"Saved: {changed['requirement_id']} v{changed['version']} status={changed['status']}")
    except (KeyError, ValueError, json.JSONDecodeError) as exc:
        print('ERROR:', exc, file=sys.stderr)
        return 1
    return 0

if __name__ == '__main__':
    sys.exit(main())
