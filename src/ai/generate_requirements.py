
import json
from typing import Literal

from dotenv import load_dotenv
from openai import OpenAI
from pydantic import BaseModel

load_dotenv()
client = OpenAI()


# Define the fields that OpenAI must return.
class ProposedRequirement(BaseModel):
    title: str
    requirement: str
    rationale: str
    uncertainty: str
    confidence: Literal["low", "medium", "high"]


def generate_requirements(clusters):
    requirements = []

    for index, cluster in enumerate(clusters, start=1):
        print(
            f"Generating requirement {index}/{len(clusters)}"
        )

        # Only send relevant cluster information to the AI.
        cluster_input = {
            "title": cluster["title"],
            "category": cluster["category"],
            "summary": cluster["summary"],
            "uncertainty": cluster.get("uncertainty", "")
        }

        response = client.responses.parse(
            model="gpt-4.1-mini",
            instructions="""
            You are an automotive product requirements analyst.

            Given a cluster of customer complaints,
            propose ONE product requirement.

            Rules:
            - Base the requirement on the supplied evidence.
            - Write a clear requirement using "should".
            - Describe the desired outcome, not an invented
              technical implementation.
            - Do not invent measurements or performance targets.
            - Explain why the requirement is proposed.
            - Record uncertainty and missing information.
            - Confidence reflects how clearly the cluster
              supports the proposal, not statistical certainty.
            - Do not claim the requirement is already approved.
            """,
            input=json.dumps(cluster_input),
            text_format=ProposedRequirement
        )

        proposed = response.output_parsed

        if proposed is None:
            raise RuntimeError(
                f"No requirement generated for "
                f"{cluster['cluster_id']}"
            )

        # Attach evidence IDs using Python.
        # Do not ask the AI to invent or copy these.
        requirement = {
            "requirement_id": f"REQ-{index:03d}",
            "cluster_id": cluster["cluster_id"],
            "category": cluster["category"],
            "source_ids": cluster["source_ids"],
            "finding_ids": cluster["finding_ids"],
            "feedback_count": cluster["feedback_count"],
            **proposed.model_dump(),
            "review_status": "pending"
        }

        requirements.append(requirement)

    return requirements


if __name__ == "__main__":

    # Fictional cluster data for testing.
    clusters = [
        {
            "cluster_id": "CLUSTER-001",
            "title": "Long-distance seat discomfort",
            "category": "Comfort",
            "summary": (
                "Customers report uncomfortable seats "
                "during extended driving sessions."
            ),
            "finding_ids": ["FIND-001", "FIND-002"],
            "source_ids": [
                "FEEDBACK-001",
                "FEEDBACK-002"
            ],
            "feedback_count": 2,
            "uncertainty": ""
        },
        {
            "cluster_id": "CLUSTER-002",
            "title": "Unclear charging duration",
            "category": "Charging",
            "summary": (
                "Customers struggle to find how much "
                "time remains until charging is complete."
            ),
            "finding_ids": ["FIND-003", "FIND-004"],
            "source_ids": [
                "FEEDBACK-003",
                "FEEDBACK-004"
            ],
            "feedback_count": 2,
            "uncertainty": ""
        }
    ]

    requirements = generate_requirements(clusters)

    print("\nPROPOSED REQUIREMENTS:")
    print(
        json.dumps(
            requirements,
            indent=2,
            ensure_ascii=False
        )
    )
