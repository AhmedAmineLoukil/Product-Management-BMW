"""Offline service and UI tests. All records are synthetic."""
import csv
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from src.copilot import analyze, runs, run_data, scope_warnings, portfolio_export
from src.ai.db import list_requirements, get_requirement, revise_requirement, audit_history, connect


class CopilotTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.db = Path(self.temp.name) / 'demo.sqlite3'
        self.run = analyze(self.db, vehicle='F70', market='GB')
        self.req = list_requirements(self.db)[0]

    def action(self, action, **kw):
        return revise_requirement(self.req['requirement_id'], actor='Demo PM', action=action,
                                  rationale='Synthetic review rationale', db_path=self.db, **kw)

    def test_end_to_end_restart_and_export(self):
        data = run_data(self.db, self.run)
        self.assertEqual(len(data['findings']), 3)
        self.assertEqual(len(data['clusters']), 2)
        from src.ai.scoring import WEIGHTS
        scored = self.action('score', ratings={k: 4 for k in WEIGHTS},
                             score_rationales={k: 'Synthetic PM assessment' for k in WEIGHTS})
        self.assertEqual(scored['priority_assessment']['score'], 80)
        approved = self.action('approve')
        self.assertEqual(get_requirement(approved['requirement_id'], self.db)['status'], 'approved')
        self.assertEqual(len(audit_history(approved['requirement_id'], self.db)), 3)
        rows = json.loads(portfolio_export(self.db, list_requirements(self.db), 'Demo PM'))
        row = next(r for r in rows if r['requirement_id'] == approved['requirement_id'])
        for key in ('market', 'priority_score', 'version', 'updated_at', 'linked_finding_ids', 'linked_source_ids',
                    'supporting_evidence', 'contradictory_evidence', 'assumptions', 'uncertainties'):
            self.assertIn(key, row)
        csv_rows = list(csv.DictReader(io.StringIO(portfolio_export(self.db, list_requirements(self.db), 'Demo PM', 'csv'))))
        self.assertEqual(len(csv_rows), 2)
        self.assertEqual(runs(self.db)[0]['summary']['metrics']['evidence_validation_rate'], 1)

    def test_duplicate_preserves_decisions(self):
        self.action('reject')
        self.assertEqual(analyze(self.db, vehicle='F70', market='GB'), self.run)
        self.assertEqual(len(list_requirements(self.db)), 2)
        self.assertEqual(get_requirement(self.req['requirement_id'], self.db)['status'], 'rejected')

    def test_edit_postpone_challenge_and_stale_write(self):
        self.action('edit', description='Improve comfort on longer trips.')
        with self.assertRaises(ValueError):
            self.action('reject', expected_version=1)
        self.action('postpone', review_date='2027-01-10')
        challenged = self.action('challenge')
        self.assertEqual(challenged['challenges'][0]['state'], 'pending_ai_review')
        self.assertTrue(challenged['challenges'][0]['source_ids'])
        history = audit_history(self.req['requirement_id'], self.db)
        self.assertEqual(history[1]['old_json']['description'], self.req['description'])
        with connect(self.db) as c:
            self.assertEqual(c.execute('SELECT count(*) FROM workflow_events').fetchone()[0], 1)
        with self.assertRaises(Exception):
            with connect(self.db) as c:
                c.execute('DELETE FROM audit_events')

    def test_missing_score_and_external_gate(self):
        self.assertIsNone(self.req['priority_assessment']['score'])
        with self.assertRaises(ValueError):
            self.action('approve')
        with self.assertRaises(PermissionError):
            analyze(self.db, vehicle='F70', market='GB', mode='live')
        warnings = scope_warnings([{'record_type': 'customer_study_metric', 'market_scope': 'EU'},
                                   {'record_type': 'vehicle_equipment', 'market': 'DE'},
                                   {'record_type': 'sales_volume', 'market': 'GB'}], 'GB')
        self.assertTrue(any('EU' in w for w in warnings))
        self.assertTrue(any('DE' in w for w in warnings))
        self.assertTrue(any('forecasts' in w for w in warnings))


class WorkspaceTests(unittest.TestCase):
    def test_empty_pages_and_dashboard_shortcut(self):
        from streamlit.testing.v1 import AppTest
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'BMW_DB_PATH': str(Path(directory) / 'ui.sqlite3')}):
            app = AppTest.from_file(str(Path(__file__).resolve().parents[1] / 'app/dashboard.py'), default_timeout=30).run()
            for page in ('Executive dashboard', 'Data & analysis', 'Findings explorer', 'Requirements portfolio', 'Evaluation & export'):
                app.sidebar.radio[0].set_value(page).run()
                self.assertFalse(app.exception, page)
            analyze(Path(directory) / 'ui.sqlite3', vehicle='F70', market='GB')
            app.sidebar.radio[0].set_value('Executive dashboard').run()
            next(b for b in app.button if b.label == 'Review requirements').click().run()
            self.assertFalse(app.exception)
            self.assertEqual(app.sidebar.radio[0].value, 'Requirements portfolio')

    def test_unconfirmed_decision_does_not_persist(self):
        from streamlit.testing.v1 import AppTest
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'BMW_DB_PATH': str(Path(directory) / 'ui.sqlite3')}):
            db = Path(directory) / 'ui.sqlite3'
            analyze(db, vehicle='F70', market='GB')
            before = list_requirements(db)
            app = AppTest.from_file(str(Path(__file__).resolve().parents[1] / 'app/dashboard.py'), default_timeout=30).run()
            app.sidebar.radio[0].set_value('Requirements portfolio').run()
            next(x for x in app.radio if x.label == 'Decision').set_value('reject')
            next(x for x in app.text_input if x.label.startswith('Responsible PM')).set_value('UI Demo PM')
            next(x for x in app.text_area if x.label.startswith('Reason / challenge')).set_value('Synthetic rationale')
            next(b for b in app.button if b.label == 'Save decision to audit trail').click().run()
            self.assertFalse(app.exception)
            self.assertTrue(any('Confirm the action' in x.value for x in app.error))
            self.assertEqual(list_requirements(db), before)

    def test_review_actions_in_ui(self):
        from streamlit.testing.v1 import AppTest
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'BMW_DB_PATH': str(Path(directory) / 'ui.sqlite3')}):
            analyze(Path(directory) / 'ui.sqlite3', vehicle='F70', market='GB')
            app = AppTest.from_file(str(Path(__file__).resolve().parents[1] / 'app/dashboard.py'), default_timeout=30).run()
            app.sidebar.radio[0].set_value('Requirements portfolio').run()
            for action in ('postpone', 'edit', 'challenge', 'reject'):
                next(x for x in app.radio if x.label == 'Decision').set_value(action)
                next(x for x in app.text_input if x.label.startswith('Responsible PM')).set_value('UI Demo PM')
                next(x for x in app.text_area if x.label.startswith('Reason / challenge')).set_value('Synthetic reason for ' + action)
                if action == 'edit':
                    next(x for x in app.text_area if x.label.startswith('Revised wording')).set_value('Improve everyday seating comfort.')
                if action == 'postpone':
                    next(x for x in app.text_input if x.label.startswith('Postpone review date')).set_value('2027-02-01')
                next(x for x in app.checkbox if x.label.startswith('I confirm this action')).check()
                next(b for b in app.button if b.label == 'Save decision to audit trail').click().run()
                self.assertFalse(app.exception)
            history = [e for r in list_requirements(Path(directory) / 'ui.sqlite3')
                       for e in audit_history(r['requirement_id'], Path(directory) / 'ui.sqlite3')]
            for action in ('postpone', 'edit', 'challenge', 'reject'):
                self.assertTrue(any(e['event_type'] == 'pm_' + action for e in history))

    def test_ui_synthetic_review_export(self):
        from streamlit.testing.v1 import AppTest
        from src.data.loader import DataRepository
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'BMW_DB_PATH': str(Path(directory) / 'ui.sqlite3')}), patch('src.copilot.load_inventory', return_value=DataRepository()):
            app = AppTest.from_file(str(Path(__file__).resolve().parents[1] / 'app/dashboard.py'), default_timeout=30).run()
            self.assertFalse(app.exception)
            app.sidebar.radio[0].set_value('Data & analysis').run()
            self.assertFalse(app.exception)
            next(b for b in app.button if b.label == 'Run analysis').click().run()
            self.assertFalse(app.exception)
            app.sidebar.radio[0].set_value('Findings explorer').run()
            self.assertFalse(app.exception)
            app.sidebar.radio[0].set_value('Requirements portfolio').run()
            self.assertFalse(app.exception)
            next(x for x in app.text_input if x.label == 'PM identifier').set_value('UI Demo PM')
            next(x for x in app.text_area if x.label == 'Scoring change rationale').set_value('Fixture assessment')
            for factor in ('Customer Impact', 'Market Relevance', 'Future Relevance', 'Rough Feasibility'):
                next(x for x in app.selectbox if x.label == factor).set_value(4)
            for x in app.text_input:
                if x.label.startswith('Reason: '):
                    x.set_value('Fixture evidence and PM judgment')
            next(b for b in app.button if b.label == 'Save documented ratings').click().run()
            self.assertFalse(app.exception)
            next(x for x in app.text_input if x.label.startswith('Responsible PM')).set_value('UI Demo PM')
            next(x for x in app.text_area if x.label.startswith('Reason / challenge')).set_value('Reviewed fixture evidence')
            next(x for x in app.checkbox if x.label.startswith('I confirm this action')).check()
            next(b for b in app.button if b.label == 'Save decision to audit trail').click().run()
            self.assertFalse(app.exception)
            app.run()
            self.assertEqual(sum(r['status'] == 'approved' for r in list_requirements(Path(directory) / 'ui.sqlite3')), 1)
            app.sidebar.radio[0].set_value('Executive dashboard').run()
            self.assertFalse(app.exception)
            app.sidebar.radio[0].set_value('Evaluation & export').run()
            next(x for x in app.text_input if x.label.startswith('Export actor')).set_value('UI Demo PM')
            next(b for b in app.button if b.label == 'Prepare local portfolio export').click().run()
            self.assertFalse(app.exception)
            self.assertEqual(len(list((Path(directory) / 'exports').glob('*.json'))), 1)


if __name__ == '__main__':
    unittest.main()
