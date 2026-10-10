# Privacy review — local repository

The starting Git index contained these private paths:

- `data/raw/F70_G60_G68_G70_customer_studies.xlsx`
- `data/raw/F70_OptionList.PDF`
- `data/raw/F70_feedback_hackathon.xlsx`
- `data/raw/f70_equipment_curated.csv`
- `data/raw/sales_volumes.xlsx`
- `data/processed/catalog_pages.jsonl`
- `data/processed/equipment.jsonl`
- `data/processed/feedback.jsonl`
- `data/processed/manifest.json`
- `data/processed/sales.jsonl`
- `data/processed/study_eu.jsonl`
- `data/local/pm_decisions.sqlite3`

These paths were removed from the index with `git rm --cached` through
`scripts/untrack_private_data.ps1`; all local copies remain. This stages removal
for a future owner-reviewed commit. Existing history, remotes and older session
checkpoints are **not cleaned by this operation**. Assess those before sharing.
No commit, push, merge, deployment, history rewrite or external data transfer was
performed.

`data/`, `exports/`, caches, database sidecars and environment secrets are ignored.
Entire was disabled in `.entire/settings.json`, and local Codex Entire hooks were
cleared to prevent this session from triggering checkpoints. Assess already
existing checkpoints separately. Restoring hooks requires a privacy review.

Use an ignored local path for `BMW_DB_PATH`; exporting private portfolios is local
and audited, but downloaded copies need to be kept out of shared folders.
Do not publish the Streamlit instance with private data. Real processing requires
explicit authorization in the UI and a separately configured credential.
