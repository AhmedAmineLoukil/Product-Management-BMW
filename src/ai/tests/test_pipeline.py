import json
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

from src.ai import run_ai_pipeline
from src.ai.schemas import ExtractionBatch, FindingExtraction, RequirementBatch, RequirementDraft


def extracted(quote="Seats hurt.", summary="Uncomfortable seats", kind="complaint"):
    return ExtractionBatch(findings=[FindingExtraction(
        finding_type=kind, category="Comfort", summary=summary,
        evidence_quote=quote, needs_review=False, uncertainties=[],
    )])


def proposed(ids=None, sources=None):
    return RequirementBatch(requirements=[RequirementDraft(
        description="Improve seat comfort during extended journeys.", category="Comfort",
        linked_finding_ids=ids if ids is not None else ["F0001"],
        linked_source_ids=sources if sources is not None else ["s1"],
        assumptions=[], uncertainties=[],
    )])


def response(parsed):
    return SimpleNamespace(output_parsed=parsed, output=[], status="completed")


def client_with(*values):
    client = Mock()
    client.responses.parse.side_effect = [
        value if isinstance(value, Exception) else response(value) for value in values
    ]
    return client


def record(text="Seats hurt.", sid="s1", **metadata):
    return dict(source_id=sid, vehicle="Synthetic vehicle", text=text, **metadata)


class PipelineTests(unittest.TestCase):
    def test_valid_feedback_and_pending_requirement(self):
        client = client_with(extracted(), proposed())
        raw = record(market="DE", source_type="survey", source_file="synthetic.txt",
                     source_location="line 1")
        result = run_ai_pipeline([raw], client=client)
        self.assertEqual(result["validation_errors"], [])
        self.assertEqual(result["findings"][0]["source_reference"], raw)
        self.assertTrue(result["findings"][0]["evidence_valid"])
        requirement = result["proposed_requirements"][0]
        self.assertEqual(requirement["decision_status"], "pending")
        self.assertEqual(requirement["evidence_level"], "single_record")
        json.dumps(result)
        for call in client.responses.parse.call_args_list:
            self.assertFalse(call.kwargs["store"])
            self.assertEqual(call.kwargs["model"], "gpt-5-mini")
            self.assertIn("text_format", call.kwargs)

    def test_empty_feedback_and_empty_batch_make_no_calls(self):
        client = Mock()
        self.assertEqual(run_ai_pipeline([], client=client)["findings"], [])
        result = run_ai_pipeline([record("  ")], client=client)
        self.assertEqual(result["validation_errors"][0]["code"], "empty_feedback")
        client.responses.parse.assert_not_called()

    def test_multilingual_quotes_stay_verbatim(self):
        for text in ["Die Sitze sind unbequem.", "座椅不舒服。", "Les sièges sont inconfortables."]:
            with self.subTest(text=text):
                result = run_ai_pipeline([record(text)], client=client_with(extracted(text), proposed()))
                self.assertTrue(result["findings"][0]["evidence_valid"])
                self.assertEqual(result["findings"][0]["evidence_quote"], text)

    def test_duplicate_findings_count_distinct_records(self):
        batch = extracted()
        batch.findings.append(batch.findings[0].model_copy())
        result = run_ai_pipeline([record(), record(sid="s2")], client=client_with(
            batch, extracted(), proposed(["F0001", "F0002", "F0003"], ["s1", "s2"])))
        cluster = result["clusters"][0]
        self.assertEqual(cluster["supporting_record_count"], 2)
        self.assertEqual(len(cluster["finding_ids"]), 3)
        self.assertEqual(cluster["source_ids"], ["s1", "s2"])
        self.assertTrue(cluster["possible_near_duplicates"])
        self.assertEqual(result["proposed_requirements"][0]["evidence_level"], "multiple_records")

    def test_near_duplicate_summaries(self):
        result = run_ai_pipeline([record(), record(sid="s2")], client=client_with(
            extracted(summary="Uncomfortable seat"), extracted(summary="Uncomfortable seats"),
            proposed(["F0001", "F0002"], ["s1", "s2"])))
        self.assertEqual(len(result["clusters"]), 1)

    def test_invalid_quotes_never_support_requirements(self):
        for quote in ["Comfortable seats", "", "seats hurt."]:
            client = client_with(extracted(quote))
            result = run_ai_pipeline([record()], client=client)
            self.assertFalse(result["findings"][0]["evidence_valid"])
            self.assertTrue(result["findings"][0]["needs_review"])
            self.assertEqual(result["proposed_requirements"], [])
            self.assertEqual(client.responses.parse.call_count, 1)

    def test_missing_or_ambiguous_source_reference(self):
        client = Mock()
        result = run_ai_pipeline([{"vehicle": "Synthetic", "text": "Seats hurt."}], client=client)
        self.assertEqual(result["validation_errors"][0]["code"], "invalid_record")
        result = run_ai_pipeline([record(), record()], client=client)
        self.assertEqual(result["findings"], [])
        self.assertEqual(result["validation_errors"][0]["code"], "duplicate_source_id")
        client.responses.parse.assert_not_called()

    def test_invalid_requirement_references_are_flagged(self):
        for ids, sources in [(["invented"], ["s1"]), (["F0001"], []),
                             (["F0001"], ["invented"]), ([], [])]:
            result = run_ai_pipeline([record()], client=client_with(extracted(), proposed(ids, sources)))
            requirement = result["proposed_requirements"][0]
            self.assertTrue(requirement["needs_review"])
            self.assertEqual(requirement["evidence_level"], "unsupported")
            self.assertEqual(requirement["decision_status"], "pending")
            self.assertTrue(result["validation_errors"])

    def test_missing_malformed_and_unavailable_responses(self):
        for value in [None, {"findings": "invalid"}, RuntimeError("unavailable")]:
            result = run_ai_pipeline([record()], client=client_with(value))
            self.assertEqual(result["findings"], [])
            self.assertEqual(result["validation_errors"][0]["code"], "extraction_failed")

    def test_refusal_and_incomplete_response(self):
        for value in [SimpleNamespace(output_parsed=extracted(), status="incomplete", output=[]),
                      SimpleNamespace(output_parsed=None, status="completed", output=[
                          SimpleNamespace(content=[SimpleNamespace(type="refusal")])])]:
            client = Mock()
            client.responses.parse.return_value = value
            result = run_ai_pipeline([record()], client=client)
            self.assertEqual(result["findings"], [])
            self.assertEqual(result["validation_errors"][0]["code"], "extraction_failed")

    def test_generation_failure_preserves_findings(self):
        result = run_ai_pipeline([record()], client=client_with(extracted(), RuntimeError()))
        self.assertEqual(len(result["findings"]), 1)
        self.assertEqual(result["proposed_requirements"], [])
        self.assertEqual(result["validation_errors"][0]["code"], "requirement_generation_failed")

    def test_unclear_is_reviewed_without_requirement(self):
        result = run_ai_pipeline([record()], client=client_with(extracted(kind="unclear")))
        self.assertTrue(result["findings"][0]["needs_review"])
        self.assertEqual(result["proposed_requirements"], [])

    def test_unsupported_input_shape(self):
        result = run_ai_pipeline("not a list", client=Mock())
        self.assertEqual(result["validation_errors"][0]["code"], "invalid_input")

    def test_positive_feedback_and_unmet_need(self):
        for kind, text in [("positive_feedback", "The seats feel comfortable."),
                           ("unmet_need", "I wish the seats were more comfortable.")]:
            result = run_ai_pipeline([record(text)], client=client_with(
                extracted(text, kind=kind), proposed()))
            self.assertEqual(result["findings"][0]["finding_type"], kind)
            self.assertEqual(result["proposed_requirements"][0]["decision_status"], "pending")

    def test_generation_cannot_approve_itself(self):
        draft = proposed().model_dump()
        draft["requirements"][0]["decision_status"] = "approved"
        draft["requirements"][0]["assumptions"] = ["Seat discomfort persists on long trips."]
        result = run_ai_pipeline([record()], client=client_with(extracted(), draft))
        requirement = result["proposed_requirements"][0]
        self.assertEqual(requirement["decision_status"], "pending")
        self.assertTrue(requirement["needs_review"])

    def test_empty_extraction_and_missing_generation(self):
        result = run_ai_pipeline([record()], client=client_with(ExtractionBatch(findings=[])))
        self.assertEqual(result["validation_errors"][0]["code"], "no_findings")
        result = run_ai_pipeline([record()], client=client_with(extracted(), None))
        self.assertEqual(result["validation_errors"][0]["code"], "requirement_generation_failed")


if __name__ == "__main__":
    unittest.main()
