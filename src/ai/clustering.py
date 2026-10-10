"""Conservative lexical clustering; counts represent only supplied records."""

from difflib import SequenceMatcher
import re


def normalized(text):
    return " ".join(re.findall(r"\w+", text.casefold()))


def cluster_findings(findings):
    clusters = []
    for finding in findings:
        if not finding["evidence_valid"] or finding["finding_type"] == "unclear":
            continue
        match = None
        for cluster in clusters:
            representative = cluster["representative"]
            if (finding["category"] == representative["category"]
                    and finding["finding_type"] == representative["finding_type"]
                    and finding["source_reference"]["vehicle"] ==
                    representative["source_reference"]["vehicle"]):
                left, right = normalized(finding["summary"]), normalized(representative["summary"])
                if left and right and SequenceMatcher(None, left, right).ratio() >= 0.9:
                    match = cluster
                    break
        if match is None:
            match = {"cluster_id": f"C{len(clusters) + 1:04d}",
                     "representative": finding, "finding_ids": [], "source_ids": []}
            clusters.append(match)
        match["finding_ids"].append(finding["finding_id"])
        if finding["source_id"] not in match["source_ids"]:
            match["source_ids"].append(finding["source_id"])
    for cluster in clusters:
        representative = cluster.pop("representative")
        cluster["summary"] = representative["summary"]
        cluster["category"] = representative["category"]
        cluster["finding_type"] = representative["finding_type"]
        cluster["supporting_record_count"] = len(cluster["source_ids"])
        cluster["possible_near_duplicates"] = len(cluster["finding_ids"]) > 1
    return clusters
