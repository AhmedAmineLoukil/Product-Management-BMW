# AI pipeline backend contract

From the project root import `run_ai_pipeline` from `src.ai`. Call
`run_ai_pipeline(records, client=client)` to inject an OpenAI-compatible client
or a mocked client. With no client, OpenAI is initialized lazily from the
caller's process environment. The pipeline never loads `.env`. Non-empty valid
records cause live calls when a real client is used; use only authorized data.
Importing the module and running the offline tests make no network requests.

## Input

`records` must be a Python list of dictionaries. Required fields are
`source_id` (non-empty string, unique per record), `vehicle` (string, no taxonomy
assumed), and `text` (string). Optional fields are `market`, `source_type`,
`source_file`, and `source_location`, each a string or explicit null.
Other fields and type coercion are rejected. Location is assumed to be a string;
the backend should normalize structured locations before calling this module.
Omitted metadata remains omitted; explicit nulls are preserved.
Duplicate source IDs are rejected entirely because provenance is ambiguous.
Invalid records produce errors and do not prevent processing other valid records.
Empty feedback produces an error without an API call. An empty list is valid.

Synthetic example:

```python
records = [{"source_id": "synthetic-1", "vehicle": "Demo vehicle",
            "text": "The seats are uncomfortable during long trips.",
            "source_type": "synthetic survey", "source_location": "row 1"}]
```

## Output

The returned dictionary is JSON-serializable and always contains four lists:

- `findings`: the original `FindingExtraction` fields (`finding_type`, `category`,
  `summary`, `evidence_quote`, `needs_review`, `uncertainties`), plus `finding_id`,
  `source_id`, `source_reference` (the full supplied normalized record, including
  text), and `evidence_valid`. Quotes are observations; summaries are AI
  interpretations. A non-empty quote must be an exact case-sensitive Unicode
  substring of that record's text. Invalid findings stay visible and are reviewed,
  but are excluded from clustering and generation. Unclear findings need review.
- `clusters`: `cluster_id`, `summary`, `category`, `finding_type`, `finding_ids`,
  `source_ids`, `supporting_record_count`, `possible_near_duplicates`.
  Similarity is lexical (normalized summaries, ratio >= 0.9), restricted to the
  same vehicle, category, and finding type. Every contributing ID is retained;
  counts are distinct source IDs, not finding counts or population demand.
- `proposed_requirements`: `requirement_id`, `description`, `category`,
  `linked_finding_ids`, `linked_source_ids`, `evidence_level`, `assumptions`,
  `uncertainties`, `decision_status`, `needs_review`. Evidence levels are
  `unsupported`, `single_record`, or `multiple_records`; these measure validated
  references only, not statistical strength or correctness of the interpretation.
  Linked source IDs must equal the sources of all linked findings. Invalid links
  are retained and flagged, never silently repaired. `decision_status` is always
  `pending`. All proposals require human decisions regardless of `needs_review`.
- `validation_errors`: dictionaries with `code` and applicable `record_index`,
  `source_id`, `finding_id`, or `requirement_id`; invalid top-level input also
  includes `reason`. No raw exception messages or credentials are exposed.

IDs (`F0001`, `C0001`, `R0001`, etc.) are unique within a run, not across runs.
The backend must namespace them with its own run identifier for persistence.
Errors include `invalid_input`, `invalid_record`, `duplicate_source_id`,
`empty_feedback`, `no_findings`, `extraction_failed`, `invalid_evidence_quote`,
`requirement_generation_failed`, `missing_finding_references`,
`duplicate_references`, `unknown_finding_id`, `unknown_source_id`,
`source_finding_mismatch`, `missing_valid_evidence`, `unclear_support`, and
`empty_requirement`. Model refusals, malformed output, missing output, incomplete
responses, and SDK failures become stage failure codes. Partial findings survive
generation failure.

## Operation and limitations

Extraction uses one structured request per non-empty record; generation uses one
request for all supported findings. Both use `gpt-5-mini` and `store=False`.
No numerical targets, specifications, business rules, or priority scores are
requested. Semantic entailment and invented specifications cannot be proven by
substring/reference checks: reviewers must assess proposals and assumptions.
Multilingual extraction preserves quotes, but lexical clustering does not reliably
merge paraphrases or equivalent problems across languages. Similar wording can
still describe different situations. Duplicate source text with distinct IDs
counts as distinct supplied records; it does not establish independent respondents.
There is no persistence, async execution, token-budget batching, or retry policy
beyond the caller's SDK configuration. Large batches need backend size limits.

## Commands (PowerShell, project root)

Offline syntax and unit checks:

```powershell
.venv/Scripts/python.exe -m compileall -q src/ai
.venv/Scripts/python.exe -m unittest discover -s src/ai/tests -v
```

Offline synthetic pipeline execution using mocked responses:

```powershell
.venv/Scripts/python.exe -c "import json; from src.ai import run_ai_pipeline; from src.ai.tests.test_pipeline import record, client_with, extracted, proposed; print(json.dumps(run_ai_pipeline([record()], client=client_with(extracted(), proposed())), indent=2, ensure_ascii=False))"
```

For an authorized live integration, the backend calls the same function with its
configured real client. The existing `test_openai.py` demo remains unchanged and
does make a live request when explicitly run; it is not part of the offline suite.
