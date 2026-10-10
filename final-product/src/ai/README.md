# Combined AI feedback pipeline

This package combines source-grounded extraction, scope-isolated semantic grouping,
and customer-facing requirement drafts. `scripts/analyze_bridge.py` connects it to
the React app through the local Vite server. `src/backend/services/analysis_service.py`
validates the input and records API usage.

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
- The module itself does not read spreadsheets or save browser state. The React
  import and integration layers handle those tasks and leave unknown PM score
  dimensions unset.
- Semantic grouping and requirement wording are model suggestions, not verified
  facts. Quotes are checked exactly; their interpretation still needs a person.
- Do not put API keys or raw customer data in Git. Keep credentials in the
  runtime environment and input files outside the repository.
