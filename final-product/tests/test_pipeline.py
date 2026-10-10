"""Merged three-stage contract tests; no external API calls."""
import json
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
from src.ai import run_ai_pipeline
from src.ai.schemas import ExtractionBatch, FindingExtraction, ClusteringBatch, SemanticCluster, RequirementDraft
from scripts.run_ai_f70 import SimulatedClient, SYNTHETIC
from src.backend.services.analysis_service import analyze_records


def extraction(quote='Seats hurt.', kind='complaint'):
    return ExtractionBatch(findings=[FindingExtraction(finding_type=kind, category='Comfort', summary='Seat discomfort', customer_need='Comfort', evidence_quote=quote, needs_review=False, uncertainties=[])])

def grouping(ids=None):
    return ClusteringBatch(clusters=[SemanticCluster(title='Seat comfort', summary='Discomfort', category='Comfort', finding_type='complaint', finding_ids=ids or ['F0001'], uncertainty='')])

def draft():
    return RequirementDraft(description='Improve comfort during extended journeys.', category='Comfort', rationale='Source feedback.', confidence='low', assumptions=[], uncertainties=[])

def client(*values):
    c=Mock();c.responses.parse.side_effect=[v if isinstance(v,Exception) else SimpleNamespace(output_parsed=v,output=[],status='completed') for v in values];return c

def record(text='Seats hurt.', sid='s1', **extra):
    return dict(source_id=sid, vehicle='F70', market='GB', text=text, **extra)

class PipelineTests(unittest.TestCase):
    def test_three_stages_and_attached_provenance(self):
        c=client(extraction(),draft());r=run_ai_pipeline([record()],client=c)
        self.assertEqual(r['validation_errors'],[])
        self.assertEqual(r['proposed_requirements'][0]['linked_source_ids'],['s1'])
        self.assertEqual(r['proposed_requirements'][0]['decision_status'],'pending')
        self.assertEqual(c.responses.parse.call_count,2)
        self.assertTrue(all(call.kwargs['store'] is False for call in c.responses.parse.call_args_list))
        json.dumps(r)

    def test_empty_and_invalid_inputs_never_call_model(self):
        c=Mock()
        for data in [[],[record(' ')],[{'text':'missing ids'}],[record(),record()],'bad']:
            self.assertEqual(run_ai_pipeline(data,client=c)['proposed_requirements'],[])
        c.responses.parse.assert_not_called()

    def test_empty_input_never_initializes_client(self):
        with patch('openai.OpenAI',side_effect=AssertionError('must not construct')):
            self.assertEqual(run_ai_pipeline([])['validation_errors'],[])

    def test_exact_quotes_in_multiple_languages(self):
        for text in ['Die Sitze sind unbequem.','座椅不舒服。','Les sièges sont inconfortables.']:
            r=run_ai_pipeline([record(text)],client=client(extraction(text),draft()))
            self.assertTrue(r['findings'][0]['evidence_valid'])

    def test_invalid_quotes_are_excluded(self):
        for text in ['seats hurt.','','Invented']:
            c=client(extraction(text));r=run_ai_pipeline([record()],client=c)
            self.assertFalse(r['findings'][0]['evidence_valid']);self.assertEqual(r['clusters'],[])
            self.assertEqual(c.responses.parse.call_count,1)

    def test_unknown_cluster_ids_fall_back_with_uncertainty(self):
        r=run_ai_pipeline([record(),record('Seats hurt.',sid='s2')],client=client(extraction(),extraction(),grouping(['invented']),draft(),draft()))
        self.assertEqual(r['clusters'][0]['source_ids'],['s1'])
        self.assertIn('semantic_clustering_failed_fallback_used',[e['code'] for e in r['validation_errors']])
        self.assertTrue(r['proposed_requirements'][0]['uncertainties'])
        self.assertTrue(r['proposed_requirements'][0]['needs_review'])

    def test_duplicate_assignments_rejected(self):
        r=run_ai_pipeline([record(),record('Seats hurt.',sid='s2')],client=client(extraction(),extraction(),grouping(['F0001','F0001']),draft(),draft()))
        self.assertTrue(r['validation_errors'])

    def test_scope_isolation(self):
        data=[dict(SYNTHETIC[0]),dict(SYNTHETIC[1])];data[1]['market']='FR'
        r=run_ai_pipeline(data,client=SimulatedClient())
        self.assertEqual(len(r['clusters']),2);self.assertEqual({c['market'] for c in r['clusters']},{'GB','FR'})

    def test_generation_failure_retains_findings(self):
        r=run_ai_pipeline([record()],client=client(extraction(),RuntimeError()))
        self.assertEqual(len(r['findings']),1);self.assertEqual(r['proposed_requirements'],[])
        self.assertEqual(r['validation_errors'][0]['code'],'requirement_generation_failed')

    def test_unclear_never_generates_requirements(self):
        c=client(extraction(kind='unclear'));r=run_ai_pipeline([record()],client=c)
        self.assertEqual(r['clusters'],[]);self.assertTrue(r['findings'][0]['needs_review'])

    def test_model_env_is_used(self):
        c=client(extraction(),draft())
        with patch.dict('os.environ',{'OPENAI_MODEL':'configured-model'}):run_ai_pipeline([record()],client=c)
        self.assertTrue(all(call.kwargs['model']=='configured-model' for call in c.responses.parse.call_args_list))

    def test_api_batch_limits_and_scope(self):
        for records in [[],[record()]*51,[record(),dict(record(sid='s2'),market='FR')]]:
            with self.assertRaises(ValueError):analyze_records(records,client=Mock())
        self.assertEqual(len(analyze_records(SYNTHETIC,client=SimulatedClient())['proposed_requirements']),2)

    def test_api_rejects_partial_failures(self):
        with self.assertRaises(ValueError):analyze_records([record()],client=client(RuntimeError()))

if __name__=='__main__':unittest.main()
