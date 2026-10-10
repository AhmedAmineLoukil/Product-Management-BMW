# BMW InsightPilot frontend

The React product workspace now runs from the repository root. It uses Vite for
the browser app and a local-only Vite middleware for `/api/analyze`, `/api/chat`,
and `/api/collect`; credentials stay in the Python process and are never sent to
browser JavaScript.

## Run locally

From the repository root:

```powershell
.venv/Scripts/python.exe -m pip install -r requirements.txt
npm install
npm run dev
```

Open `http://127.0.0.1:5173/`. If that port is already in use, Vite prints the
alternate localhost URL.

The offline workspace works without credentials. Live AI analysis and chat need
`OPENAI_API_KEY` in `.env` or the shell environment before starting Vite. Public
source collection works without an OpenAI key.

## Verify

```powershell
.venv/Scripts/python.exe -m unittest discover -s tests -v
npm run build
npm test
npm run check:edge
npm run test:db
```

For browser coverage, start Vite first and then run:

```powershell
$env:BASE_URL = 'http://127.0.0.1:5173'
npm run test:e2e
```

Use the URL Vite printed if it selected a different port.

## Legacy tools

The Streamlit dashboard and existing FastAPI module remain available:

```powershell
.venv/Scripts/python.exe -m streamlit run app/dashboard.py
.venv/Scripts/python.exe -m uvicorn src.api:app --host 127.0.0.1 --port 8000
```
