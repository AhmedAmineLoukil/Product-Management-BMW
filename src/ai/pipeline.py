"""Synchronous orchestration with injectable client for offline testing."""

from pydantic import ValidationError

from .clustering import cluster_findings
from .evidence import validate_finding, validate_requirement
from .extraction import extract_findings
from .requirements import generate_requirements
from .schemas import FeedbackRecord


def run_ai_pipeline(records, *, client=None):
    result = {"findings": [], "clusters": [], "proposed_requirements": [],
              "validation_errors": []}

    def error(code, **context):
        result["validation_errors"].append({"code": code, **context})

    if not isinstance(records, list):
        error("invalid_input", reason="records must be a list")
        return result
    accepted = {}
    # Reject ambiguous IDs entirely instead of silently overwriting provenance.
    duplicates = set()
    for index, raw in enumerate(records):
        try:
            record = FeedbackRecord.model_validate(raw)
        except (ValidationError, TypeError):
            error("invalid_record", record_index=index)
            continue
        if record.source_id in accepted:
            duplicates.add(record.source_id)
            error("duplicate_source_id", source_id=record.source_id)
        else:
            accepted[record.source_id] = record
    for sid in duplicates:
        accepted.pop(sid, None)

    def get_client():
        nonlocal client
        if client is None:
            from openai import OpenAI
            client = OpenAI()  # Uses environment supplied by the caller; no .env loading.
        return client

    for record in accepted.values():
        if not record.text.strip():
            error("empty_feedback", source_id=record.source_id)
            continue
        try:
            extracted = extract_findings(get_client(), record)
        except Exception:
            # Do not expose exception messages, which can contain request data.
            error("extraction_failed", source_id=record.source_id)
            continue
        if not extracted:
            error("no_findings", source_id=record.source_id)
        for item in extracted:
            finding = item.model_dump()
            finding.update(finding_id=f"F{len(result['findings']) + 1:04d}",
                           source_id=record.source_id,
                           source_reference=record.model_dump(exclude_unset=True))
            if finding["finding_type"] == "unclear":
                finding["needs_review"] = True
            if not validate_finding(finding, accepted):
                error("invalid_evidence_quote", finding_id=finding["finding_id"],
                      source_id=record.source_id)
            result["findings"].append(finding)
    result["clusters"] = cluster_findings(result["findings"])
    if not result["clusters"]:
        return result
    try:
        drafts = generate_requirements(get_client(), result["findings"], result["clusters"])
    except Exception:
        error("requirement_generation_failed")
        return result
    findings_by_id = {f["finding_id"]: f for f in result["findings"]}
    for index, draft in enumerate(drafts, 1):
        requirement = draft.model_dump()
        requirement["requirement_id"] = f"R{index:04d}"
        for code in validate_requirement(requirement, findings_by_id, accepted):
            error(code, requirement_id=requirement["requirement_id"])
        result["proposed_requirements"].append(requirement)
    return result
