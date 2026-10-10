"""End-to-end synchronous pipeline with injectable client for local demos."""

from pydantic import ValidationError
from concurrent.futures import ThreadPoolExecutor

from .clustering import cluster_findings, singleton_fallback
from .evidence import validate_finding, validate_requirement
from .extraction import extract_findings
from .requirements import generate_requirements
from .schemas import FeedbackRecord


def run_ai_pipeline(records, *, client=None, workers=1):
    """Return findings, semantic clusters, draft requirements, and validation errors.

    Pass an OpenAI-compatible client to avoid constructing one here. Without
    one, the OpenAI SDK is imported lazily and reads its key from the process
    environment. This function deliberately does not load a local .env file.
    """
    result = {
        "findings": [], "clusters": [], "proposed_requirements": [],
        "validation_errors": [],
    }

    def add_error(code, **context):
        result["validation_errors"].append({"code": code, **context})

    if not isinstance(records, list):
        add_error("invalid_input", reason="records must be a list")
        return result

    valid_records = {}
    duplicate_ids = set()
    for index, raw in enumerate(records):
        try:
            record = FeedbackRecord.model_validate(raw)
        except (ValidationError, TypeError):
            add_error("invalid_record", record_index=index)
            continue
        if record.source_id in valid_records:
            duplicate_ids.add(record.source_id)
            add_error("duplicate_source_id", source_id=record.source_id)
        else:
            valid_records[record.source_id] = record
    for source_id in duplicate_ids:
        valid_records.pop(source_id, None)

    def get_client():
        nonlocal client
        if client is None:
            from openai import OpenAI
            client = OpenAI(timeout=60, max_retries=1)
        return client

    def extract_one(record):
        if not record.text.strip():
            return (record, None, "empty_feedback")
        try:
            extracted = extract_findings(get_client(), record)
        except Exception:
            return (record, None, "extraction_failed")
        return (record, extracted, None)

    ordered = list(valid_records.values())
    if workers > 1 and ordered:
        get_client()  # Construct the shared client before starting threads.
        with ThreadPoolExecutor(max_workers=min(workers, 4)) as pool:
            extracted_rows = list(pool.map(extract_one, ordered))
    else:
        extracted_rows = [extract_one(record) for record in ordered]

    for record, extracted, issue in extracted_rows:
        if issue:
            add_error(issue, source_id=record.source_id)
            continue
        if not extracted:
            add_error("no_findings", source_id=record.source_id)
        for extracted_finding in extracted:
            finding = extracted_finding.model_dump()
            finding_id = f"F{len(result['findings']) + 1:04d}"
            finding.update(
                finding_id=finding_id,
                source_id=record.source_id,
                source_reference=record.model_dump(exclude_unset=True),
            )
            if finding["finding_type"] == "unclear":
                finding["needs_review"] = True
            if not validate_finding(finding, valid_records):
                add_error("invalid_evidence_quote", finding_id=finding_id,
                          source_id=record.source_id)
            result["findings"].append(finding)

    if not any(f["evidence_valid"] and f["finding_type"] != "unclear" for f in result["findings"]):
        return result
    try:
        result["clusters"] = cluster_findings(get_client(), result["findings"])
    except Exception:
        add_error("semantic_clustering_failed_fallback_used")
        result["clusters"] = singleton_fallback(result["findings"])

    if not result["clusters"]:
        return result
    try:
        drafts = generate_requirements(get_client(), result["findings"], result["clusters"])
    except Exception:
        add_error("requirement_generation_failed")
        return result

    findings_by_id = {finding["finding_id"]: finding for finding in result["findings"]}
    for index, draft in enumerate(drafts, start=1):
        requirement = dict(draft)
        requirement["requirement_id"] = f"R{index:04d}"
        errors = validate_requirement(
            requirement, findings_by_id, valid_records, result["clusters"]
        )
        for code in errors:
            add_error(code, requirement_id=requirement["requirement_id"])
        result["proposed_requirements"].append(requirement)
    return result
