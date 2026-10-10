# Run BMW InsightPilot on Windows

Install Node.js 22+ and Python 3.10+. Open PowerShell in this folder and run:

```powershell
powershell -ExecutionPolicy Bypass -File .\start-local.ps1
```

Open http://127.0.0.1:5173/. Keep the terminal open. Ctrl+C stops the app.
The first start installs dependencies. No credentials are needed for the
synthetic demo, file import, offline analysis, scoring, decisions or export.

Create a vehicle/market project in Settings, upload CSV/XLSX feedback in Data
Sources, validate the mapping, and run demo analysis. Inspect evidence and
review the resulting requirements. Changes persist in this browser; export
the workspace from Settings for a backup.

Live AI/chat use the repository's existing `.env` when this folder is inside it.
You can also copy `.env.example` to `.env` in this folder and set your own
server-side `OPENAI_API_KEY`; this overrides repository values. Restart, then
check Settings → Refresh service status. Only use records permitted for external
processing. Live chat was verified with fictional inputs; hosted Supabase was
not deployed or exercised.

Windows verification: production build, 88 frontend/HTTP tests, 30 Python tests,
10 database scenarios, cloud function type checks and 50 Chrome scenarios passed.
Seven Python tests skipped because private fixtures were absent. Desktop/mobile
screenshots were inspected; no mobile viewport overflow or browser runtime errors.

Version 1.1 adds useful chatbot answers, cancel/reset, backup restoration,
corrupt-workspace recovery, CSV export and service diagnostics. It fixes live
analysis payloads, Windows paths, Unicode imports, stale source previews and
follow-up visibility. See RELEASE-NOTES.md. This release uses GitHub
`codex/integrated-product` commit `2e8895c` plus the local repairs.
