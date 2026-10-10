"""Programmatic checks that keep AI drafts tied to supplied feedback."""


def validate_finding(finding, records):
    record = records.get(finding["source_id"])
    quote = finding["evidence_quote"]
    valid = record is not None and bool(quote.strip()) and quote in record.text
    finding["evidence_valid"] = valid
    if not valid:
        finding["needs_review"] = True
        if "Evidence quote is missing or not verbatim." not in finding["uncertainties"]:
            finding["uncertainties"].append("Evidence quote is missing or not verbatim.")
    return valid


def validate_requirement(requirement, findings, records, clusters):
    errors = []
    finding_ids = requirement["linked_finding_ids"]
    source_ids = requirement["linked_source_ids"]
    if not finding_ids:
        errors.append("missing_finding_references")
    if len(finding_ids) != len(set(finding_ids)) or len(source_ids) != len(set(source_ids)):
        errors.append("duplicate_references")
    if any(fid not in findings for fid in finding_ids):
        errors.append("unknown_finding_id")
    if any(sid not in records for sid in source_ids):
        errors.append("unknown_source_id")

    linked = [findings[fid] for fid in finding_ids if fid in findings]
    expected_sources = {finding["source_id"] for finding in linked}
    if not source_ids or set(source_ids) != expected_sources:
        errors.append("source_finding_mismatch")
    if not linked or any(not finding["evidence_valid"] for finding in linked):
        errors.append("missing_valid_evidence")
    if any(finding["finding_type"] == "unclear" for finding in linked):
        errors.append("unclear_support")

    linked_set = set(finding_ids)
    matching_clusters = [
        cluster for cluster in clusters
        if set(cluster["finding_ids"]) == linked_set
    ]
    if not matching_clusters:
        errors.append("references_do_not_match_one_cluster")
    elif any(cluster["category"] != requirement["category"] for cluster in matching_clusters):
        errors.append("category_mismatch")
    if not requirement["description"].strip():
        errors.append("empty_requirement")

    requirement["decision_status"] = "pending"
    requirement["needs_review"] = bool(
        errors or requirement["assumptions"] or requirement["uncertainties"]
        or any(finding["needs_review"] for finding in linked)
    )
    requirement["evidence_level"] = (
        "unsupported" if errors else
        "multiple_records" if len(expected_sources) > 1 else "single_record"
    )
    requirement["validation_errors"] = list(dict.fromkeys(errors))
    return errors
