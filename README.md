# BMW InsightPilot

BMW InsightPilot turns vehicle feedback into traceable product proposals. A product manager can inspect the original records, change a proposed requirement, challenge a finding, set priority ratings, and approve or reject with a reason. The React app is the main product.

## Start in one command

On this Mac, open Terminal and paste:

```sh
cd /Users/saif/Documents/ChatGPT/Hackathon/TUM-TUM-AI
./start-local.sh
```

The first start may install Node and Python packages. Open **http://127.0.0.1:5173/**. Keep Terminal open while using the app. Press **Control+C** in Terminal to stop it. Use this address, not the old `file:///.../index.html` page. On another computer, install Node.js 20+ and Python 3.10+ first, then run `./start-local.sh` from the cloned repository.

No credentials are needed for the offline demonstration. It starts with a clearly labeled synthetic BMW iX1/Germany project. Local changes are saved in this browser's IndexedDB, with a small-demo local-storage copy for older browsers. They are not shared with teammates or secured by login.

For the supplied BMW sources, place these files in the ignored `data/raw/` folder on your own computer: `F70_feedback_hackathon.xlsx`, `F70_G60_G68_G70_customer_studies.xlsx`, `sales_volumes.xlsx`, `F70_OptionList.PDF`, and `f70_equipment_curated.csv`. The library shows which are available and reads them without writing a processed data file. A teammate without these private files can still use the synthetic demo. Do not add the private files or an exported workspace to Git.

## Follow the workflow

1. Open **Data Sources → Internal data**. In **BMW data library**, choose a vehicle and one of the markets actually present in the supplied files, then click **Load this vehicle + market**. The app creates or selects that exact project. For example, F70/United Kingdom has customer feedback; G68/China has study and shared-series sales context, but no supplied customer verbatims. The selector at the top changes which datasets, findings, requirements, history, and assistant context you see.
2. Inspect the imported source cards. Repeated F70 annotation rows become one comment with every original annotation retained. Study means, US study response fractions, 2024/2025 sales, future-looking 2030 sales, and catalog pages have their original measure and source location. G60/G68 sales remain explicitly combined; the German F70 equipment catalog is not shown as UK equipment. You can also upload your own CSV or XLSX, map columns, validate, and import it.
3. Select the validated **Customer verbatims** dataset. **Run demo analysis** scans all selected comments with fast, transparent keyword rules and produces tentative proposals. With a configured key, **Run live AI analysis** extracts exact quotes, groups related signals within the same vehicle and market, and drafts customer-facing requirements. Local live AI uses explicit batches of up to 50 records and logs each batch's coverage; you can run further batches separately. Reference sources remain available to the PM and assistant, and never masquerade as customer complaints.
4. Open **Evidence Explorer** and a finding. Click its source IDs to see the original text and any contradiction or uncertainty. Findings can be challenged by a person.
5. In **Settings**, enter your name as the responsible PM before making a decision on supplied data. Open **Requirements** or **Review Queue**. Inspect evidence and the separate product/market context, edit the wording, set or leave priority dimensions unknown, and approve, reject, or request evidence with a written reason. AI cannot make a PM decision.
6. Open **Prioritization** for the score breakdown. The number of selected records is a sample count, not a population frequency. Unknown impact, strategy, and feasibility stay unknown until assessed.
7. Open **Audit Trail** and **Data Sources → Analysis history** to see decisions, previous versions, linked records, run time, model calls, and token usage. Click **Ask InsightPilot** for source-linked answers about the selected project.
8. In **External research**, choose F70, G60, G68, or G70. Fetch a BMW PressClub preset or enter a public HTTPS review/article URL, inspect the preview, and explicitly import. These records stay labeled as external context and do not enter feedback analysis.

The browser demo can be reset in **Settings**. Export data before resetting if you need to keep it.

## Turn on live AI

```sh
cp .env.example .env
```

Put your own `OPENAI_API_KEY` value in `.env`, then restart `./start-local.sh`. The file is ignored by Git. Never put a key in a `VITE_` variable or browser code. The local Vite server calls Python, and Python calls the OpenAI Responses API with `store=False`. The assistant and analysis check exact quotes and IDs before showing/saving output. The analysis log records elapsed seconds, API calls, and input/output tokens. Actual API cost depends on your account and selected model; no live call was possible during this integration because no key was available.

Only start a live analysis when the supplied feedback is permitted to be sent to your configured model provider. The offline demo and public collector work without a key. If the live button is missing, check `.env`, restart, and make sure you selected a validated **Customer verbatims** dataset.

## What is real, and what is a demo?

| Capability | Current behavior |
| --- | --- |
| React workspace, file import, project selector, source links, review/edit/challenge/approval, scoring, local audit/export | Working locally; browser IndexedDB stores larger workspaces. |
| Supplied BMW data library | Reads all available supplied source roles in their actual vehicle/market scopes. It keeps original fields and provenance, deduplicates repeated F70 annotations, and clearly labels shared or future-looking measures. Requires the private files on the local computer. |
| Offline analysis | A transparent keyword demonstration, not an LLM or a verified reading of customer sentiment. |
| Python live analysis and AI assistant | Implemented server side with evidence checks; needs `OPENAI_API_KEY`. Live provider behavior and cost were not verified without credentials. |
| Public source collector | Fetches allowed HTML/JSON-LD pages after a robots check, throttles requests, caches for 24 hours, deduplicates by vehicle/market/page/text, and retains URL and dates. A blocked/unreadable page gives an error. Market applicability is a PM judgment, not inferred from the chosen market label. |
| Optional Supabase cloud backend | Schema, functions, auth rules, and database checks are in the repository. No hosted account was supplied, so deployment, hosted AI, and multiuser behavior remain unverified. The assistant and collector currently use the local server. |
| Supplied BMW files | Read from your computer only; never packaged in the app or included in this branch's new commit. Do not commit raw or processed BMW customer data. |

The collector's BMW PressClub presets are official product information, not customer reviews. A third-party page is labeled editorial review only when structured review data or a review title is present. An absent publication date is shown as unknown, never invented. The collector checks model names or codes but does not silently assume a page applies to the selected market. Public pages may change or block automated access.

## How the team branches contributed

| Branch | Useful behavior carried into this product |
| --- | --- |
| `main` | BMW workbook ingestion, vehicle data conventions, scoring concepts, and legacy Streamlit tools. The historical BMW input files are excluded from the new commit. |
| `feature/ai-engine` | Source-grounded signal extraction, exact quote checks, and a lexical grouping baseline. |
| `feature/saif-ai` | Scope-aware semantic grouping and customer-facing requirement drafting. |
| `hakim` | Python backend analysis service, requirement review/audit structure, and SQLite prototype. The primary React workflow uses the integrated state engine. |
| `feature/insightpilot-modern-ui-20261010` | Responsive React workspaces, CSV/XLSX import, versioned PM decisions, audit trail, and optional Supabase backend. |
| `codex/merged-ai-pipeline` | Combined Python AI pipeline and Entire configuration, repaired and connected to React here. |

The new branch is `codex/integrated-product`. Existing source branches and `main` were not changed or merged into. This is a functional integration, not a claim that every legacy screen or endpoint is part of the main app. The old Streamlit app and FastAPI/SQLite prototype remain as reference tools; start the React product with `./start-local.sh`.

## Method choice and limits

See [docs/method-comparison.md](docs/method-comparison.md) for the measured synthetic benchmark. The chosen live grouping method isolates vehicle, market, category, and finding type, skips API calls for singletons, then asks the model to merge only related findings within a scope. It validates memberships and derives source links in Python. The fastest zero-API exact grouping cannot join paraphrases. The older lexical baseline missed paraphrases and combined records across markets in the test. A mock model demonstrated the scoped algorithm; actual semantic accuracy and latency still need a live credential-backed evaluation.

## Development and verification

With dependencies installed, run:

```sh
npm run build
npm test
npm run check:edge
npm run test:db
.venv/bin/python -m unittest discover -s tests -q
.venv/bin/python scripts/benchmark_grouping.py
# While ./start-local.sh is running, with Chrome installed:
npm run test:e2e
```

The regular browser checks use synthetic data. They cover upload, analysis, record links, requirement review, audit, project isolation, mobile layout, assistant citations, and external collector preview/import. When private files are present locally, `node scripts/bmw-browser-check.mjs` also checks a real F70/UK import, browser persistence, the full offline analysis, G68/China reference-only scope, and mobile source selection. Screenshots go only to ignored `artifacts/`. Python tests for private workbook outputs skip when processed outputs are absent; this does not mean the private files were committed. Local PostgreSQL checks use PGlite, not a hosted Supabase database.

## Optional shared deployment

The `supabase/` folder contains migrations and Edge Functions from the React branch. For a shared deployment, use a dedicated Supabase project, run `npm run sync:backend`, apply migrations with `supabase db push`, provision PM users, deploy `workspace` and `analyze`, and set `APP_ORIGIN`, `OPENAI_API_KEY`, and `OPENAI_MODEL` as server-side secrets. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local` only after provisioning. Local browser data is not automatically copied into Supabase. Cloud deployment must be tested separately before presenting it as working.

## Entire and Git

This repository contains `.entire/settings.json` and `.codex/hooks.json`. Entire is installed on this Mac, but Codex hook execution requires approval in the Codex **/hooks** UI. `entire status` and checkpoint history must show a real checkpoint before claiming that the mandatory Entire requirement has been satisfied. A normal Git commit or installed hook file alone is not proof.

The new branch ignores `.env`, `data/`, local databases, virtual environments, build output, and screenshots. Keep supplied BMW files in `data/raw/` or outside the repository. Before any future commit, check `git status` and confirm no private data or credentials are staged.
