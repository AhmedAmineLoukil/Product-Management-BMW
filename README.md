# BMW Product Requirements Copilot

The integrated React PM workspace is now available from the repository root. See
[FRONTEND.md](FRONTEND.md) for the current local workflow, [DEMO.md](DEMO.md) for
the legacy dashboard workflow and [PRIVACY_REVIEW.md](PRIVACY_REVIEW.md) for
tracked-data cleanup and remaining historical exposure. Start with:

```powershell
.venv/Scripts/python.exe -m pip install -r requirements.txt
npm install
npm run dev
```

Open the localhost URL printed by Vite. The Streamlit dashboard remains available
as a fallback:

```powershell
.venv/Scripts/python.exe -m streamlit run app/dashboard.py --server.address 127.0.0.1
```

The workspace includes dashboard, data preview and authorized analysis, findings,
requirement evidence and conflict inspection, six-factor PM scoring, decisions,
version comparisons, pending challenges, evaluation and local CSV/JSON export.

Local evidence-first pipeline for data engineering and AI proposals. AI never
approves requirements or supplies final numerical priority scores. Existing F70
scripts and the SQLite PM dashboard remain compatible.

## Setup and commands (VS Code PowerShell, repository root)

```powershell
.venv/Scripts/python.exe -m pip install -r requirements.txt
.venv/Scripts/python.exe -m unittest discover -s tests -v

# Offline preview: load/filter/validate; no model calls
.venv/Scripts/python.exe scripts/run_pipeline.py --mode preview --vehicle F70 --country GB --limit 20

# Complete offline synthetic demonstration, including SQLite PM integration
.venv/Scripts/python.exe scripts/run_pipeline.py --mode synthetic --vehicle G60 --batch-size 2 --output-dir data/processed/demo --db data/local/demo.sqlite3
.venv/Scripts/python.exe scripts/evaluate_pipeline.py

# PM dashboard (select the database created above)
$env:BMW_DB_PATH = 'data/local/demo.sqlite3'
.venv/Scripts/python.exe -m streamlit run app/dashboard.py
```

Only after authorization for external transfer of confidential BMW data:

```powershell
# OPENAI_API_KEY must be set securely in the environment or local ignored .env
.venv/Scripts/python.exe scripts/run_pipeline.py --mode live --vehicle F70 --country GB --limit 10 --model gpt-5.6-luna --batch-size 2 --references data/processed --output-dir data/processed/live --allow-external-data-transfer
```

Model availability depends on the account. The retained repository default is
configurable with `--model` or `OPENAI_MODEL`. No live calls were used for verification.
API implementation uses Pydantic parsing and `store=False`, following the
[official Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs)
and [Responses guidance](https://developers.openai.com/api/docs/guides/migrate-to-responses).
`store=False` does not itself confer Zero Data Retention.

## Data engineering

```powershell
# Supply only files that actually exist locally
.venv/Scripts/python.exe scripts/ingest_data.py --kind feedback --vehicle G70 --input data/raw/G70_feedback_hackathon.xlsx --output data/processed/g70_feedback.jsonl
.venv/Scripts/python.exe scripts/ingest_data.py --kind study --study-layout bmw-wide --market EU --input data/raw/F70_G60_G68_G70_customer_studies.xlsx --output data/processed/studies_multi.jsonl
.venv/Scripts/python.exe scripts/ingest_data.py --kind sales --vehicle G60 --input data/raw/sales_volumes.xlsx --output data/processed/g60_sales.jsonl
.venv/Scripts/python.exe scripts/ingest_data.py --kind equipment --vehicle F70 --market DE --input data/raw/F70_OptionList.PDF --output data/processed/equipment_candidates.jsonl
```

The reader supports CSV, XLSX, XLS (xlrd), JSONL and text PDFs. It reads all workbook
sheets, normalizes headers and preserves original headers, values, cell locations
and PDF pages. Scanned PDFs require a separate OCR workflow. Supply a vehicle
when it is absent; never assign a single vehicle to mixed-vehicle sheets without
checking scope. Presentation-style spreadsheets need an explicit layout adapter;
`bmw-wide` discovers F70/G60/G70 columns and Mean rows, retaining unknown scales
and sample sizes. Market scope must be supplied from verified document metadata.

`DataRepository` in `src/data/loader.py` provides `load_feedback`, `load_equipment`,
`load_customer_studies`, `load_sales`, vehicle/market discovery, derivative filters,
quality reporting and conflict-detecting incremental merge. Annotation rows sharing
an actual feedback identity count once; equal text from different IDs is retained.
Inconsistent versions are separate records marked for review. Customer text is not
translated, trimmed or overwritten. Legacy curated F70 equipment remains unchanged.

Equipment candidates have **unknown** availability. `verify_equipment` requires a
named reviewer, rationale and matching original page excerpt. Package-dependent
availability requires package IDs. Variants, dependencies and restrictions remain
explicit, with no interpretation of uncertain PDF table alignment.

## AI and evidence interfaces

`run_ai_pipeline(records, client=..., references=..., batch_size=...,
stable_identifiers=True)` returns findings, clusters, proposed requirements,
evidence links, conflicts and validation errors. Injected clients support offline
tests. Implicit client creation requires explicit authorization. The unified runner
uses stable content-derived IDs; the old interface retains sequential IDs for
compatibility with existing integrations.

Exact quotes are checked against original text. Invalid and unclear findings cannot
support proposals. Proposal source IDs must match their actual finding sources;
mixed vehicle/market proposals are unsupported. `validate_graph` checks duplicate
IDs, missing sources/pages/clusters, graph references and scope inconsistencies.
Requirement outputs add vehicle, market, linked clusters, evidence links, confidence,
uncertainties and conflicts while preserving existing `decision_status=pending`.
SQLite keeps append-only human decision events and deterministic scoring.

Clustering combines conservative lexical similarity with a narrow seat-discomfort
paraphrase rule. Positive/negative kinds, vehicles and markets stay separate;
distinct source IDs determine counts and market distributions. Merges are marked
for review. This is an explainable heuristic, not a general embedding model.

Cross-source candidates match scoped topics. Sales are contextual only. Market
mismatches and unverified equipment are unverified. Support/contradiction requires
a curated `reviewed_evidence_relation`, `verification_status=verified` and
`review_rationale`. Broad study scores never cancel specific complaints. Conflicts
are potential disagreements for PM review, not automatically resolved facts.

`ManagedClient` supports private local caching keyed by model, schema, prompt and
payload; bounded temporary-error retries; token usage and optional per-million-token
prices. Missing pricing/usage yields null cost rather than invented estimates.
The unified live runner caches in its output directory. Do not publish caches.

## Approved external research

`config/research_allowlist.json` starts with exact official BMW Group Report 2025
URLs. These were verified against the
[BMW report announcement](https://www.press.bmwgroup.com/global/article/detail/T0456174EN/bmw-group-report-2025).
Add competitor/market-study documents only after source review. No external research
claims are fabricated or included in generated outputs by default.

`ResearchRepository.ingest_offline` requires an exact claim excerpt in supplied
source text and retains title, publisher, URL, dates, relevance and limitations.
`fetch(..., allow_network=True)` supports timeouts, bounded retries, document caches,
size limits and no automatic redirects. Fetching is optional and was not exercised
against live websites in tests. Review fetched text/PDF locally before selecting claims.

```powershell
.venv/Scripts/python.exe scripts/ingest_research.py --input data/raw/approved_research_excerpts.jsonl
```

Each offline input object needs `url`, `text`, `claim`, `vehicle` and optional `market`,
`publication_date`, `retrieved_at`, `limitations`. Research records can then be loaded
with the unified runner's `--references` directory. Avoid loading overlapping legacy
and reprocessed sources together: duplicate IDs are rejected rather than overwritten.

## Outputs and evaluation

Outputs: `sources.jsonl`, `findings.jsonl`, `clusters.jsonl`, `requirements.jsonl`,
`evidence_links.jsonl`, `conflicts.jsonl`, `validation_report.json`. Preview writes
only a validation report. Reports include time, quote validation, graph errors,
unsupported proposals and available usage. They are confidential for real runs.

The synthetic demo produces three findings, two need clusters and two pending
requirements, including “Improve seating comfort during extended trips.” and
“Make frequently used climate settings easier to access.” Synthetic assumptions
remain explicit; these are not BMW requirements or evidence of real-model quality.

For real evaluation, a PM should independently label a representative approved
sample, recording each source ID, expected exact quote, category, finding type and
optional need group. Keep labels local. For unclear/no-signal comments use an empty
findings list. Then run:

```powershell
.venv/Scripts/python.exe scripts/evaluate_pipeline.py --run-dir data/processed/live --labels data/local/reviewed_labels.jsonl
```

Metrics are exact extraction agreement, quote validation, source coverage,
clustering pair precision/recall and unsupported requirement count. Synthetic
developer-authored labels measure mock integration only. PM-reviewed accuracy,
representativeness, multilingual semantic clustering and real API cost remain to
be evaluated. New code tests use only synthetic fixtures; legacy private integration
tests skip when their private datasets are absent.

## Privacy and remaining work

`data/`, caches, outputs, databases and credentials are ignored. **The starting
repository already tracks confidential raw and processed datasets. Ignore rules
do not remove tracked files or prior history.** Before any sharing, a repository
owner must assess Git/remote/session history cleanup. Removal from future tracking
is now staged with local files preserved; see PRIVACY_REVIEW.md. This implementation
does not commit, push, merge or rewrite history.

Live BMW analysis needs explicit data-transfer authorization; no confidential text
was printed by the new runner or sent to a model during implementation. G60/G70
normalization is covered by synthetic tests; their actual files/layouts need local
validation when available and authorized. Equipment availability still requires
visual review. The existing dashboard displays linked findings and requirement
uncertainties and now includes evidence-link/conflict panels in the integrated PM
workspace, using the additive fields and persisted run outputs.
