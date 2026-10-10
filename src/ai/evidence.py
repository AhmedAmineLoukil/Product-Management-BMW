"""Programmatic provenance checks; no model-based approval."""


def validate_finding(finding, records):
    record = records.get(finding["source_id"])
    quote = finding["evidence_quote"]
    valid = record is not None and bool(quote.strip()) and quote in record.text
    finding["evidence_valid"] = valid
    if not valid:
        finding["needs_review"] = True
        finding["uncertainties"].append("Evidence quote is missing or not verbatim.")
    return valid


def validate_requirement(requirement, findings, records):
    errors = []
    ids = requirement["linked_finding_ids"]
    sources = requirement["linked_source_ids"]
    if not ids:
        errors.append("missing_finding_references")
    if len(ids) != len(set(ids)) or len(sources) != len(set(sources)):
        errors.append("duplicate_references")
    if any(fid not in findings for fid in ids):
        errors.append("unknown_finding_id")
    if any(sid not in records for sid in sources):
        errors.append("unknown_source_id")
    linked = [findings[fid] for fid in ids if fid in findings]
    expected = {f["source_id"] for f in linked}
    if not sources or set(sources) != expected:
        errors.append("source_finding_mismatch")
    if not linked or any(not f["evidence_valid"] for f in linked):
        errors.append("missing_valid_evidence")
    if any(f["finding_type"] == "unclear" for f in linked):
        errors.append("unclear_support")
    if not requirement["description"].strip():
        errors.append("empty_requirement")
    requirement["decision_status"] = "pending"
    requirement["needs_review"] = (
        bool(errors or requirement["assumptions"] or requirement["uncertainties"])
        or any(f["needs_review"] for f in linked)
    )
    requirement["evidence_level"] = (
        "unsupported" if errors else
        "multiple_records" if len(expected) > 1 else "single_record"
    )
    requirement["uncertainties"].extend(errors)
    return errors
