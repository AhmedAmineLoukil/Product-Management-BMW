from dotenv import load_dotenv
from openai import OpenAI

from schemas import FindingExtraction


def main() -> None:
    load_dotenv()
    client = OpenAI()

    # Synthetic customer feedback (not real BMW data).
    feedback = "The seats are uncomfortable during long trips."

    response = client.responses.parse(
        model="gpt-5-mini",
        instructions=(
            "Analyze the customer feedback and extract one finding. "
            "Do not invent information that is not supported by the feedback. "
            "Use an exact, non-empty substring of the feedback as evidence_quote. "
            "Set needs_review when the finding is uncertain and describe any "
            "uncertainties in uncertainties; otherwise use an empty list."
        ),
        input=feedback,
        text_format=FindingExtraction,
        store=False,
    )

    for item in response.output:
        if item.type == "message":
            for content in item.content:
                if content.type == "refusal":
                    print("The model refused the request; no finding is available.")
                    return

    finding = response.output_parsed
    if finding is None:
        print("No parsed finding was returned; no evidence has been verified.")
        return

    if not finding.evidence_quote or finding.evidence_quote not in feedback:
        finding.needs_review = True
        finding.uncertainties.append(
            "Invalid evidence_quote: it is empty or is not an exact substring "
            "of the original feedback."
        )
        print("WARNING: Invalid evidence quote; do not treat it as verified evidence.")

    print(finding.model_dump_json(indent=2))


if __name__ == "__main__":
    main()
