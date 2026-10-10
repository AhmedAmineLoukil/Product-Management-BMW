"""Regression checks for local bridge contracts; no network or paid model calls."""
import io
import json
import os
import runpy
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

import httpx
import openai
from scripts.bridge_errors import error_response
from scripts.health_bridge import health
from src.backend.services import collector
from src.backend.services.analysis_service import analyze_records


class BridgeTests(unittest.TestCase):
    def test_analysis_bridge_unwraps_records_and_preserves_unicode(self):
        records = [{'source_id': '测试', 'text': 'Größe, 中国, café 🚗'}]
        output = io.StringIO()
        with patch('sys.stdin', io.StringIO(json.dumps({'records': records}))), redirect_stdout(output), patch('src.backend.services.analysis_service.analyze_records', return_value={'text': records[0]['text']}) as analyze:
            runpy.run_path('scripts/analyze_bridge.py', run_name='__main__')
        analyze.assert_called_once_with(records)
        self.assertEqual(json.loads(output.getvalue())['text'], records[0]['text'])

    def test_bridge_rejects_null_and_missing_key_without_provider_calls(self):
        for request in ('null', '{}'):
            output = io.StringIO()
            with patch('sys.stdin', io.StringIO(request)), redirect_stdout(output), self.assertRaises(SystemExit):
                runpy.run_path('scripts/analyze_bridge.py', run_name='__main__')
            self.assertIn('error', json.loads(output.getvalue()))

    def test_health_has_real_local_dependencies_without_constructing_a_client(self):
        with patch('openai.OpenAI', side_effect=AssertionError('No network client allowed')):
            result = health()
        self.assertTrue(result['pythonReady'])
        self.assertEqual(result['dependencies'], {'chat': True, 'analysis': True, 'collector': True})

    def test_health_reports_import_failure_without_private_diagnostics(self):
        with patch('scripts.health_bridge.importlib.import_module', side_effect=ImportError('private credential diagnostic')):
            result = health()
        self.assertFalse(any(result['dependencies'].values()))
        self.assertNotIn('private credential', json.dumps(result))

    def test_provider_errors_are_actionable_and_do_not_echo_response_details(self):
        request = httpx.Request('POST', 'https://api.openai.com/v1/responses')
        for error_type, status, code in ((openai.AuthenticationError, 401, 'invalid_key'), (openai.RateLimitError, 429, 'provider_limit'), (openai.PermissionDeniedError, 403, 'model_unavailable')):
            error = error_type('private API response detail', response=httpx.Response(status, request=request), body={'secret': 'must not be returned'})
            result = error_response(error, 'The assistant')
            self.assertEqual(result['status'], status)
            self.assertEqual(result['code'], code)
            self.assertNotIn('private API', json.dumps(result))
            self.assertNotIn('secret', json.dumps(result))

    def test_analysis_retains_safe_provider_error_instead_of_generic_extraction_failure(self):
        from unittest.mock import Mock
        client = Mock()
        error = openai.AuthenticationError('private', response=httpx.Response(401, request=httpx.Request('POST', 'https://api.openai.com')), body={})
        client.responses.parse.side_effect = error
        with self.assertRaises(openai.AuthenticationError):
            analyze_records([{'source_id': 'S1', 'vehicle': 'G60', 'market': 'Germany', 'text': 'The seats lack support.'}], client=client)

    def test_utf8_collector_cache_and_invalid_cache_recovery(self):
        html = '<h1>BMW 5 Series G60 review</h1><article><p>Größe, 中国, café 🚗</p></article>'
        url = 'https://example.org/g60'
        with tempfile.TemporaryDirectory() as temp, patch.object(collector, 'CACHE', Path(temp)), patch.object(collector, '_get', return_value=(url, html)) as fetch:
            result = collector.collect(url, 'G60', 'Germany')
            cache = next(Path(temp).glob('*.json'))
            self.assertIn('中国', cache.read_text(encoding='utf-8'))
            self.assertTrue(collector.collect(url, 'G60', 'Germany')['cached'])
            cache.write_text('{', encoding='utf-8')
            recovered = collector.collect(url, 'G60', 'Germany')
            self.assertEqual(recovered['records'][0]['text_original'], result['records'][0]['text_original'])
            self.assertEqual(fetch.call_count, 2)


if __name__ == '__main__':
    unittest.main()
