# Combined AI feedback pipeline

This package combines the two team branches' work: structured finding extraction
and strict evidence checks, plus AI semantic clustering and requirement drafts.
It is a backend module; it is not connected to the static web demo yet.

## Run it

Install the Python dependencies in your project environment:

```bash
python -m pip install openai pydantic
```

From the repository root, configure `OPENAI_API_KEY` in your shell or runtime,
then call:

```python
from src.ai import run_ai_pipeline

records = [{
    "source_id": "sample-001",
    "vehicle": "Fictional demo vehicle",
    "market": "Germany",
    "text": "The seat is uncomfortable on long journeys.",
    "source_type": "synthetic example",
}]

result = run_ai_pipeline(records)
```

Each source record is extracted separately. AI clustering is meaning-based but
kept within the same vehicle, market, category, and finding type. The pipeline
checks that evidence quotes occur verbatim in their source text, checks that
cluster IDs are neither missing nor invented, and derives source IDs in Python.
If semantic clustering fails, it preserves findings and falls back to separate
single-finding clusters, with a validation warning.

Requirement drafts carry their source and finding IDs, rationale, confidence,
assumptions, and uncertainties. They always have `decision_status: "pending"`;
the AI cannot approve them. Reference errors remain visible and require human
review.

## Limitations and data handling

- Example inputs must be synthetic unless the team has authorization to use the
  challenge data with the configured API.
- The API receives supplied feedback text. `store=False` is set on Responses API
  calls; this is not a substitute for confirming data-use requirements.
- This module does not read spreadsheets, persist results, calculate a product
  priority score, or integrate with the browser prototype.
- Semantic grouping and requirement wording are model suggestions, not verified
  facts. Quotes are checked exactly; their interpretation still needs a person.
- Do not put API keys or raw customer data in Git. Keep credentials in the
  runtime environment and input files outside the repository.
