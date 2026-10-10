
import json

from dotenv import load_dotenv
from openai import OpenAI
from pydantic import BaseModel, Field

load_dotenv()
client = OpenAI()


class Cluster(BaseModel):
    title: str
    category: str
    summary: str
    finding_ids: list[str]
    uncertainty: str


class ClusterResult(BaseModel):
    clusters: list[Cluster]


def cluster_findings(findings):
    # Only negative findings with a complaint
    complaints = [
        finding
        for finding in findings
        if finding["sentiment"] == "negative"
        and finding["complaint"].strip()
    ]

    if not complaints:
        return []

    # Give the AI only the information needed to group complaints
    ai_input = [
        {
            "finding_id": finding["finding_id"],
            "category": finding["category"],
            "complaint": finding["complaint"],
            "customer_need": finding["customer_need"],
        }
        for finding in complaints
    ]

    response = client.responses.parse(
        model="gpt-4.1-mini",
        instructions="""
        You are an automotive customer feedback analyst.

        Group findings that describe the same underlying
        customer problem.

        Rules:
        - Cluster by meaning, not just matching words.
        - Do not merge unrelated customer problems.
        - Keep different product categories separate.
        - Every input finding must belong to exactly one cluster.
        - A cluster may contain only one finding.
        - Use only finding IDs provided in the input.
        - Do not invent evidence, counts, or statistics.
        - Write short, clear cluster titles and summaries.
        - State uncertainty when grouping is ambiguous.
        """,
        input=json.dumps(ai_input),
        text_format=ClusterResult,
    )

    parsed = response.output_parsed

    if parsed is None:
        raise RuntimeError("No clustering result returned.")

    # Validate AI-provided IDs before using them.
    valid_ids = {finding["finding_id"] for finding in complaints}
    returned_ids = [
        finding_id
        for cluster in parsed.clusters
        for finding_id in cluster.finding_ids
    ]

    if (
        len(returned_ids) != len(valid_ids)
        or set(returned_ids) != valid_ids
    ):
        raise ValueError(
            "Clustering error: missing, duplicate, "
            "or invented finding IDs."
        )

    # Preserve source IDs in Python rather than trusting the AI.
    by_id = {
        finding["finding_id"]: finding
        for finding in complaints
    }

    results = []

    for index, cluster in enumerate(parsed.clusters, start=1):
        source_ids = sorted({
            source_id
            for finding_id in cluster.finding_ids
            for source_id in by_id[finding_id]["source_ids"]
        })

        results.append({
            "cluster_id": f"CLUSTER-{index:03d}",
            "title": cluster.title,
            "category": cluster.category,
            "summary": cluster.summary,
            "finding_ids": cluster.finding_ids,
            "source_ids": source_ids,
            "feedback_count": len(source_ids),
            "uncertainty": cluster.uncertainty,
        })

    return results


if __name__ == "__main__":
    # Fictional test data, not real BMW customer records
    findings = [
        {
            "finding_id": "FIND-001",
            "source_ids": ["FEEDBACK-001"],
            "category": "Comfort",
            "sentiment": "negative",
            "complaint": "Seats hurt my back during long drives",
            "customer_need": "Better long-distance seat comfort",
        },
        {
            "finding_id": "FIND-002",
            "source_ids": ["FEEDBACK-002"],
            "category": "Comfort",
            "sentiment": "negative",
            "complaint": "Seat becomes uncomfortable after two hours",
            "customer_need": "Comfortable seating over long journeys",
        },
        {
            "finding_id": "FIND-003",
            "source_ids": ["FEEDBACK-003"],
            "category": "Charging",
            "sentiment": "negative",
            "complaint": "Charging time is difficult to find",
            "customer_need": "Clear charging time information",
        },
        {
            "finding_id": "FIND-004",
            "source_ids": ["FEEDBACK-004"],
            "category": "Charging",
            "sentiment": "negative",
            "complaint": "Cannot see how long charging will take",
            "customer_need": "Visible remaining charging duration",
        },
        {
            "finding_id": "FIND-005",
            "source_ids": ["FEEDBACK-005"],
            "category": "UX",
            "sentiment": "positive",
            "complaint": "",
            "customer_need": "",
        },
    ]

    clusters = cluster_findings(findings)

    print("\nAI CLUSTERS:")
    print(json.dumps(clusters, indent=2, ensure_ascii=False))
