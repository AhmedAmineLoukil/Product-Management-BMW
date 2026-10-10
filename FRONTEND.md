# Premium requirements workspace

Run both commands from the repository root. The new React presentation reuses the existing Python services; Streamlit remains available as a fallback.

```powershell
python -m pip install -r requirements-api.txt
python -m uvicorn src.api:app --host 127.0.0.1 --port 8000
```

In another terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open http://127.0.0.1:5173. Vite proxies `/api` to the local backend. Both processes bind to localhost. `npm run build` verifies TypeScript and produces the frontend bundle. `npm run preview` also proxies to the backend; production hosting requires a same-origin `/api` reverse proxy.

The API defaults to the same database as the current Streamlit workspace: `data/local/copilot.sqlite3`. Set `BMW_DB_PATH` before starting it to select a different SQLite database. Set `BMW_DATA_PATH` for normalized local sources (default `data/processed`). No dataset is imported into the frontend build.

Implemented pages: Overview, Data Sources, AI Findings, Requirements, PM Decisions and Audit History. The header controls vehicle, market, persisted analysis and PM attribution. Requirements support search, category/status/priority/confidence filters and sort by date, score or sources. Detail tabs show original evidence, reference records, conflicting evidence, market limitations, assumptions, documented scoring and the append-only audit trail.

The Synthetic demo action invokes the existing deterministic offline fixture and clearly labels fictional results. It sends no customer records externally. Real persisted runs are loaded from the existing database. Live analysis remains in the existing Python/Streamlit workflow; this API intentionally provides no external-data-transfer endpoint.

PMs can assess priorities and approve, reject, postpone, edit or challenge proposals. Each action requires identity, rationale and the opened version. Missing scoring and unsupported approvals are rejected by the existing service. Challenge records a question for later AI review. Demo identities are attributed, not authenticated; keep this local interface on localhost.

Verification:

```powershell
python -m unittest discover -s tests
cd frontend
npm run build
npm test
```

Streamlit fallback:

```powershell
python -m streamlit run app/dashboard.py
```

Validation completed: 63 Python tests, including isolated REST decision persistence and audit integration; frontend interaction tests cover navigation, search, original quotations, scoring inspection, confirmed decision payloads and failure states. Local API, Vite and proxy HTTP checks were performed. The default F70/GB database contained no persisted runs; use Synthetic demo for an explicitly fictional walkthrough or select your existing database via `BMW_DB_PATH`.

Visual QA remains outstanding: the browser integration reported no available browser, so no screenshots, 1440px/laptop rendering inspection or real browser console verification could be performed in this session.
