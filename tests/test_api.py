"""REST integration uses isolated fictional fixtures; never customer data."""
import tempfile
import unittest
from pathlib import Path
from fastapi.testclient import TestClient
from src.api import create_app
from src.ai.scoring import WEIGHTS

class ApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.db = Path(self.temp.name) / 'api.sqlite3'
        self.client = TestClient(create_app(self.db, Path(self.temp.name) / 'inventory'))

    def test_scope_and_full_decision_lifecycle(self):
        self.assertEqual(self.client.get('/api/health').json()['status'], 'ok')
        self.assertEqual(self.client.get('/api/workspace').json()['requirements'], [])
        self.assertEqual(self.client.post('/api/analysis/synthetic', json={'vehicle':'F70','market':'GB'}).status_code, 200)
        workspace = self.client.get('/api/workspace').json()
        self.assertEqual(len(workspace['findings']), 3)
        self.assertEqual(len(workspace['requirements']), 2)
        self.assertEqual(self.client.get('/api/workspace?market=DE').json()['requirements'], [])
        req = workspace['requirements'][0]
        path = '/api/requirements/' + req['requirement_id']
        detail = self.client.get(path).json()
        self.assertTrue(detail['evidence']['sources'])
        payload = {'actor':'Fixture PM', 'action':'approve', 'rationale':'Fixture rationale', 'expected_version':1}
        self.assertEqual(self.client.post(path+'/decisions', json=payload).status_code, 422)
        payload.update(action='score', ratings={k:4 for k in WEIGHTS}, score_rationales={k:'Fixture assessment' for k in WEIGHTS})
        scored = self.client.post(path+'/decisions', json=payload)
        self.assertEqual(scored.status_code, 200, scored.text)
        self.assertEqual(scored.json()['requirement']['priority_assessment']['score'], 80)
        payload = {'actor':'Fixture PM','action':'approve','rationale':'Scored and reviewed','expected_version':2}
        self.assertEqual(self.client.post(path+'/decisions', json=payload).json()['requirement']['status'], 'approved')
        self.assertEqual(self.client.post(path+'/decisions', json=payload).status_code, 409)
        for action, extra in [('edit',{'description':'Fixture revised proposal'}),('challenge',{}),('postpone',{'review_date':'2027-01-01'}),('reject',{})]:
            current = self.client.get(path).json()['requirement']
            response = self.client.post(path+'/decisions', json={'actor':'Fixture PM','action':action,'rationale':'Fixture rationale','expected_version':current['version'],**extra})
            self.assertEqual(response.status_code, 200, response.text)
        restart = TestClient(create_app(self.db, Path(self.temp.name)/'inventory'))
        self.assertEqual(restart.get(path).json()['requirement']['status'], 'rejected')
        self.assertEqual(len(restart.get(path).json()['audit']), 7)
        self.assertTrue(restart.get('/api/audit').json())
        self.assertEqual(self.client.get('/api/requirements/missing').status_code, 404)

    def test_contract_rejects_external_processing(self):
        response = self.client.post('/api/analysis/synthetic', json={'vehicle':'F70','market':'GB','mode':'live'})
        self.assertEqual(response.status_code, 422)
        response = self.client.post('/api/requirements/missing/decisions',json={'actor':'PM','action':'reject','rationale':'x'})
        self.assertEqual(response.status_code, 422)
