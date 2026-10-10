"""Synthetic external-source and assistant tests; no network or API calls."""
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from src.ai.assistant import AssistantDraft, Citation, answer_question
from src.backend.services import collector

REVIEW_HTML = '''<html><head><title>BMW 5 Series G60 review</title><script type="application/ld+json">{"@type":"Review","reviewBody":"The seats are supportive on long trips.","datePublished":"2026-09-01"}</script></head><body><h1>BMW 5 Series G60 review</h1></body></html>'''

class ExternalSourceTests(unittest.TestCase):
    def test_review_keeps_exact_text_and_provenance(self):
        result = collector.extract_page(REVIEW_HTML, 'https://example.org/reviews/g60', 'G60', 'Europe')
        item = result['records'][0]
        self.assertEqual(item['source_type'], 'editorial_review')
        self.assertEqual(item['text_original'], 'The seats are supportive on long trips.')
        self.assertEqual(item['published_at'], '2026-09-01')
        self.assertEqual(item['source_market'], 'Not verified from page')
        self.assertEqual(item['model_match_quality'], 'exact_code')

    def test_rejects_unrelated_model_and_private_url(self):
        with self.assertRaises(ValueError):collector.extract_page(REVIEW_HTML, 'https://example.org/a', 'F70', 'Europe')
        with self.assertRaises(ValueError):collector._public_url('http://127.0.0.1/a')
        with self.assertRaises(ValueError):collector._public_url('https://localhost/a')

    def test_press_keywords_and_visible_date_identify_g68(self):
        html = '''<html><head><meta name="keywords" content="5 Series,Long Wheelbase,G68"></head>
        <body><h1>BMW 5 Series Sedan from China for China</h1>
        <span class="date">Thu Jan 25 13:30:00 CET 2024</span>
        <article><p>The extended wheelbase adds rear passenger space.</p></article></body></html>'''
        result = collector.extract_page(html, collector.PRESETS['G68', 'China'], 'G68', 'China')
        self.assertEqual(result['records'][0]['model_match_quality'], 'exact_code')
        self.assertEqual(result['records'][0]['published_at'], '2024-01-25')
        other = collector.extract_page(html, collector.PRESETS['G68', 'China'], 'G68', 'Europe')
        self.assertNotEqual(other['records'][0]['source_id'], result['records'][0]['source_id'])

    def test_caches_repeat_collection_and_rejects_robots_block(self):
        class Response:
            def __init__(self, status, text='', content=b'', content_type='text/html'):
                self.status_code=status;self.text=text;self.content=content;self.encoding='utf-8';self.headers={'Content-Type':content_type}
            def iter_content(self, _):yield self.content
            def close(self):pass
        session=Mock();session.get.side_effect=[Response(200,'User-agent: *\nAllow: /'),Response(200,content=REVIEW_HTML.encode())]
        with tempfile.TemporaryDirectory() as temp, patch.object(collector,'CACHE',Path(temp)),patch('socket.getaddrinfo',return_value=[(2,1,6,'',('93.184.215.14',443))]):
            first=collector.collect('https://example.org/reviews/g60','G60','Europe',session=session)
            second=collector.collect('https://example.org/reviews/g60','G60','Europe',session=session)
            self.assertFalse(first['cached']);self.assertTrue(second['cached']);self.assertEqual(session.get.call_count,2)
        session=Mock();session.get.return_value=Response(200,'User-agent: *\nDisallow: /')
        with patch('socket.getaddrinfo',return_value=[(2,1,6,'',('93.184.215.14',443))]):
            with self.assertRaises(ValueError):collector.collect('https://example.org/reviews/g60','G60','Europe',session=session,use_cache=False)

    def test_nhtsa_keeps_odi_citation_and_omits_vin(self):
        response=Mock(status_code=200,content=b'{}')
        response.json.return_value={'results':[{'odiNumber':12345,'summary':'Brake warning appeared.',
            'dateComplaintFiled':'10/10/2026','components':'SERVICE BRAKES','vin':'PRIVATE',
            'products':[{'productMake':'BMW','productModel':'530I','productYear':'2024'}]}]}
        session=Mock();session.get.return_value=response
        with tempfile.TemporaryDirectory() as temp, patch.object(collector,'CACHE',Path(temp)):
            result=collector.collect(None,'G60','United States',source='nhtsa',nhtsa_model='530I',model_year=2024,session=session)
        item=result['records'][0]
        self.assertEqual(item['source_id'],'NHTSA-ODI-12345')
        self.assertIn('odinumber=12345',item['source_url'])
        self.assertEqual(item['model_match_quality'],'series_model_year_variant_unverified')
        self.assertNotIn('vin',item)
        self.assertEqual(item['text_original'],'Brake warning appeared.')

class AssistantTests(unittest.TestCase):
    def payload(self):return {'question':'What supports this requirement?','project':{'id':'p1','derivative':'G60','market':'Germany'},'requirements':[],'findings':[],'sources':[{'id':'S1','text':'The seats are supportive on long trips.'}]}
    def response(self,quote):
        parsed=AssistantDraft(answer='One record discusses seat support.',citations=[Citation(source_id='S1',quote=quote)],uncertainty='Only one record.')
        return SimpleNamespace(status='completed',output_parsed=parsed,usage=SimpleNamespace(input_tokens=100,output_tokens=40))
    def test_citation_is_exact_and_no_write_tools(self):
        client=Mock();client.responses.parse.return_value=self.response('seats are supportive')
        result=answer_question(self.payload(),client=client)
        self.assertEqual(result['citations'][0]['source_id'],'S1')
        self.assertEqual(result['metrics']['input_tokens'],100)
        self.assertFalse(client.responses.parse.call_args.kwargs['store'])
    def test_invented_quote_rejected(self):
        client=Mock();client.responses.parse.return_value=self.response('invented claim')
        with self.assertRaises(ValueError):answer_question(self.payload(),client=client)

if __name__=='__main__':unittest.main()
