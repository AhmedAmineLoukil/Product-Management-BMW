# Local demonstration and verification

Install the existing Python dependencies and frontend:

```powershell
.venv/Scripts/python.exe -m pip install -r requirements-ui.txt
.venv/Scripts/python.exe -m streamlit run app/dashboard.py --server.address 127.0.0.1
```

The default database is `data/local/copilot.sqlite3`. Set `BMW_DB_PATH` to open a
different existing database. Everything stays local; running synthetic analysis
does not access OpenAI. Refreshes only reload persisted output.

1. Choose F70 and GB. Open **Data & analysis**. Inspect the selected scope and mode.
2. Keep **synthetic** selected and click **Run analysis**. Select the persisted run
   in the sidebar. This fixture generates three findings, two clusters and two
   proposals. These are fictional integration examples, never BMW conclusions.
3. Open **Findings explorer**. Inspect a quotation, original source location,
   cluster and related findings.
4. Open **Requirements portfolio**, choose a proposal and inspect supporting
   evidence and uncertainties. Review all six factor weights and explanations.
5. In **Prioritization**, enter a demo PM name and a scoring-change reason. Supply
   each missing factor rating and a rationale. Save ratings; the score is
   deterministic and remains separate from evidence confidence.
6. In **PM decision**, enter a named demo actor and reason. Approve, reject,
   postpone, edit or challenge. Approval requires completed scoring and valid
   evidence. Postpone can include a review date. Challenges remain pending for
   later AI review; no challenge sends data externally.
7. Refresh. Open **Decision history** to compare each previous and revised state.
   SQLite updates current state and appends history in one transaction.
8. Open **Executive dashboard** to review status, category and confidence charts.
9. Open **Evaluation & export**, enter a demo actor, prepare JSON or CSV and
   download. Local copies are saved beside the database in ignored `exports/`.

Offline verification:

```powershell
.venv/Scripts/python.exe -m unittest discover -s tests -v
```

Final verification: 59 tests passed, including all 53 baseline tests. The local
server started successfully and its health endpoint returned HTTP 200.

CLI portfolio exports use the same audited service:

```powershell
.venv/Scripts/python.exe scripts/export_requirements.py --db data/local/copilot.sqlite3 --actor DemoPM --output data/processed/portfolio.json
```

`tests/test_copilot.py` exercises the Streamlit app with its real SQLite services,
including analysis, evidence browsing, scoring, approval, refresh and export.
Backend tests cover edits, rejection, postponement, challenges, stale writes,
append-only history, missing scores and unauthorized API calls. Other existing
tests retain graph validation, invalid evidence, market conflicts and AI
self-approval protection.

Live analysis is available only behind the explicit confidential-data transfer
authorization checkbox, using a securely configured `OPENAI_API_KEY`. The preview
includes scope, feedback count, reference count and model. No live call was used
for implementation or verification. References may include differing markets;
these are labeled and unverified associations cannot establish support.

Limits: no authentication; named demo actors are unauthenticated. Challenges are
queued, not automatically answered. Evidence confidence is the existing discrete
source-count classification, not a calibrated probability. Clustering is a
conservative heuristic. Real data accuracy, representative sampling, equipment
availability, future assumptions and manual productivity baselines require PM
review. Only two synthetic proposals are justified by the three-record fixture;
no filler was added to reach the suggested 8–15 candidates. Visual browser QA
could not be completed because no browser connection was available; the server
health endpoint returned HTTP 200. Real analysis still needs authorization.
