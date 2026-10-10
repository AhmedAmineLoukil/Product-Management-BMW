import json
from typing import Literal

from dotenv import load_dotenv
from openai import OpenAI
from pydantic import BaseModel

load_dotenv()

client = OpenAI()


class CustomerFinding(BaseModel):
    category: Literal[
        "Comfort", "Charging", "UX",
        "Interior", "Digital Services", "Other"
    ]
    sentiment: Literal["positive", "negative", "neutral"]
    complaint: str
    customer_need: str
    uncertainty: str


def extract_findings(feedback_records):
    results = []

    for index, feedback in enumerate(feedback_records, start=1):
        print(f"Analyzing feedback {index}/{len(feedback_records)}")

        if not feedback.get("text", "").strip():
            print("Skipping empty feedback")
            continue

        response = client.responses.parse(
            model="gpt-4.1-mini",
            instructions="""
            You are an automotive customer feedback analyst.

            Extract:
            - Product category
            - Sentiment
            - Main complaint, if present
            - Customer need, if supported
            - Uncertainty

            Rules:
            - Only use the supplied customer feedback.
            - Do not invent customer problems.
            - Do not invent measurements or statistics.
            - Return an empty complaint if none exists.
            - Return an empty customer_need if unclear.
            """,
            input=feedback["text"],
            text_format=CustomerFinding
        )

        finding = response.output_parsed

        if finding is None:
            raise RuntimeError(
                f"No parsed result for {feedback['source_id']}"
            )

        result = {
            "finding_id": f"FIND-{index:03d}",
            "source_ids": [feedback["source_id"]],
            "vehicle": feedback["vehicle"],
            "market": feedback.get("market"),
            **finding.model_dump()
        }

        results.append(result)

    return results


if __name__ == "__main__":

    # Fictional test data — NOT BMW customer records
    feedback_records = [
        {
            "source_id": "FEEDBACK-001",
            "vehicle": "G60",
            "market": "Germany",
            "text": "The seats hurt my back during long drives."
        },
        {
            "source_id": "FEEDBACK-002",
            "vehicle": "G60",
            "market": "Germany",
            "text": "I cannot easily find the charging time."
        },
        {
            "source_id": "FEEDBACK-003",
            "vehicle": "G60",
            "market": "Germany",
            "text": "The infotainment screen is very responsive."
        }
    ]

    findings = extract_findings(feedback_records)

    print("\nAI FINDINGS:")
    print(json.dumps(findings, indent=2, ensure_ascii=False))
