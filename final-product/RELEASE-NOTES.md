# BMW InsightPilot 1.1

Open http://127.0.0.1:5173/ after starting `start-local.ps1`. Refresh the browser
after an update. Existing local browser workspaces are preserved.

## Chat and analysis repairs

- Existing repository `.env` loads server-side; a project `.env` can override it.
  The API key stays outside browser JavaScript.
- Settings displays actual Python, dependency, AI, chat and collector readiness.
  Refresh the status after restarting the server.
- The assistant answers evidence, review status, missing ratings, exact record IDs,
  scoring and follow-up questions. App-navigation help uses the approved local
  guide. Failed live answers fall back to clearly labeled stored evidence.
- Chat requests have timeouts, cancellation, reset and project isolation. Invalid
  citations and malformed responses are refused.
- Live analysis now passes the correct records array to Python. Failures leave the
  workspace intact, display an explanation and allow retry.

## New features and workflow fixes

- Settings can preview and restore a validated JSON workspace backup. Replacement
  requires explicit confirmation and offers a download of the current workspace.
  Cloud workspaces cannot be replaced through local restore.
- Project CSV exports include scores, priorities, original evidence references,
  provenance and unknown ratings, with spreadsheet formula protection.
- Invalid saved data has recovery-download and confirmed fresh-demo controls.
- CSV decoding preserves UTF-8 and BOM-marked UTF-16 text, including accents,
  Arabic and Chinese. Invalid encoding gets a useful message. Numeric-looking
  IDs retain leading zeros. Duplicate and later-appearing columns are preserved.
- Collector scope changes hide stale previews. Cancellation discards late results;
  malformed or mismatched vehicle/market results cannot be imported.
- Default review queues include open evidence follow-ups. Service checks cannot
  overwrite a restored workspace when they finish late.

## Verification on October 10, 2026

Production build and optional cloud function TypeScript checks passed.
**88 frontend/local HTTP tests, 30 Python tests, 10 database scenarios and 50
Chrome scenarios passed.** Seven private-data Python tests skipped because the
fixtures were absent. Desktop/mobile layouts were inspected; browser suites
reported no runtime errors or mobile viewport overflow.

Two small real-provider chat requests used fictional inputs. The grounded answer
cited an exact substring from its fictional source. This proves connectivity and
one citation workflow, not general accuracy. Full AI analysis was checked with
injected/mock clients; real-data accuracy, live site retrieval and hosted Supabase
deployment remain unverified. No real customer data was sent during these checks.

From this folder after installing dependencies:

```powershell
npm run build
npm test
npm run test:e2e
npm run test:chat
npm run test:features
npm run test:workflows
npm run test:db
npm run check:edge
python -m unittest discover -s tests -v
```

Browser tests require the app running at port 5173 and installed Chrome. They use
fresh contexts and fictional fixtures, without changing the user's saved browser
workspace. Assistant, feature and workflow tests also support `BASE_URL`.
The local readiness endpoint checks setup only; it does not make provider calls.
