# BMW InsightPilot

An interactive vehicle requirements workspace built with React, TypeScript, Vite, Tailwind CSS, shadcn-style Radix components, Lucide icons, Recharts and Supabase.

## Run locally

```sh
npm install
npm run dev
```

Open **http://localhost:5173**. On Windows PowerShell with script execution restricted, use `npm.cmd` instead of `npm`.

The application works immediately without credentials. Its default **BMW iX1 / Germany** project contains 20 synthetic customer comments, four dataset groups, 10 findings, eight requirements and an illustrative decision history. All changes persist in browser local storage. Other projects start empty. Project, requirement, evidence and audit exports are available in the interface.

## Demonstrate the central workflow

1. Open **Requirements → Simplify access to everyday controls (REQ-001)**.
2. Inspect **Version history**: the original physical-controls proposal was challenged and reframed around the customer outcome. The evidence assessment fell from 5 to 3, changing the weighted score from 98 to 90.
3. Open a linked finding, then an original source record. Inspect both supporting and contradicting comments.
4. Challenge a finding with a reason. Linked requirements reopen for review, evidence scores decrease, and all changes are recorded.
5. Edit a requirement, inspect the score breakdown, and approve or reject with a rationale.
6. Open **Audit Trail**, search its requirement ID, and inspect the before/after comparison. Reload the app to confirm persistence.

Every edit or decision preserves the previous requirement version. Unknown ratings produce an unscored result, not an invented rating. Changing weights preserves the previous scoring model. Consolidation supersedes the source requirement and returns the destination to review.

## Source files and provenance

The original user-provided files are in `public/` and accessible from **Data Sources → Supplied reference files**. They were inspected separately from the build request. The pasted build request determines the application configuration; the briefing is reference material.

- `sales_volumes.xlsx`: F70, G60_G68 and G70 worksheets. Regional columns include `market`, `market_code`, and volumes for 2024, 2025 and 2030. To import a selected year, map `region` to `market` and `units` to the chosen year. Preserve the year column; the app does not relabel 2030 values as observed sales or invent powertrain information.
- `F70_G60_G68_G70_customer_studies.xlsx`: CN/EU and US study sheets. Choose **Normalize grouped study** in the import preview. The adapter creates separate model/market sheets, carries category headings into each record, and preserves original worksheet/row/column references. CN/EU mean ratings and US response proportions retain distinct measure labels and unchanged numerical values. Import creates or selects a matching source project, separate from the iX1 demo. The adapter does not invent equivalent scales or respondent counts.
- `BMW_Hackathon_Briefing_Short.pdf`: a two-page reference briefing. It covers customer-facing product decisions and evidence transparency, with F70/G60/G68/G70 regional examples.

These supplied files are **not BMW iX1 Germany evidence**. Create an appropriately scoped project before importing them. They are not silently mixed into the synthetic demo or represented as verified research.

CSV/XLSX ingestion preserves original fields, identifiers, sheet names and row references. Explicit mapping validates required fields, duplicate identifiers, numerical values and external URLs. Invalid rows are retained and reported; datasets with issues cannot enter analysis. Demo limits are 10 MB per file and 5,000 non-empty rows per imported sheet.

## Analysis and research

The default pipeline uses deterministic keyword grouping against selected datasets. It links exact records, reports actual linked-record counts, flags weak evidence and leaves unsupported scoring dimensions unknown. It is intentionally conservative and does **not** perform semantic AI analysis or live research. Re-running the same source groups does not duplicate generated findings.

The optional `analyze` Edge Function uses the [OpenAI Responses API with Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses). A resumable server job performs three model stages: source-grounded signal extraction, semantic clustering, and customer-facing requirement generation. A fourth commit stage validates all relationships and saves the result atomically. The UI reports actual stage progress.

Each model stage has its own strict JSON Schema and an additional Zod validation pass. Extraction may reference only exact IDs from the selected records. Clustering may reference only validated signal IDs; the server derives finding source attribution from those memberships instead of asking the model to repeat source IDs. Requirement generation may reference only validated cluster IDs. Unknown IDs, duplicate IDs, a record used as both support and contradiction, incomplete responses, refusals, invalid schemas, stale workspace revisions, and insufficient-evidence inconsistencies reject the run before workspace data is written. Feasibility always remains unknown until assessed by a PM. Live runs are limited to 500 records / 350,000 serialized characters; source content is transmitted to the configured model provider only when the user selects **Run live AI analysis**.

Analysis job snapshots and model intermediates are service-only database records. Browser users cannot read them through RLS or table grants. A failed job keeps its stage and error for server-side diagnosis and an explicit retry, but no partial findings or requirements enter the product workspace.

External research accepts user-supplied source records. Live search/retrieval is explicitly unavailable. URLs are not fetched or independently verified; the application does not fabricate citations, publication dates or retrieval dates.

## Optional Supabase deployment

The default local demo is complete. No Supabase project or AI credentials were supplied, so cloud functions and live model calls have **not** been deployed or tested against a live account.

Use a dedicated Supabase project. Keep its service role key and model API key server-side.

1. Install the Supabase CLI, sign in, and link the project.
2. Run `npm run sync:backend` to synchronize the shared, tested scoring and state-transition modules into the Edge Functions.
3. Apply both migrations with `supabase db push`. The second migration creates the protected analysis-job store used for staged progress and retries.
4. Create an authentication user through the Supabase dashboard. Provision a profile, workspace and PM membership as an administrator (replace `USER_UUID`):

```sql
insert into public.profiles (id, display_name)
values ('USER_UUID', 'Product Manager');

with new_workspace as (
  insert into public.workspaces (name)
  values ('BMW Product Intelligence') returning id
)
insert into public.workspace_members (workspace_id, user_id, role)
select id, 'USER_UUID', 'pm' from new_workspace;
```

5. Deploy `supabase functions deploy workspace` and `supabase functions deploy analyze`.
6. Set Edge Function secrets: `APP_ORIGIN` (your app origin), `OPENAI_API_KEY`, and `OPENAI_MODEL` (a model supporting structured output). The workspace remains usable without the model secrets. Supabase supplies its URL, anon and service-role credentials to the function environment.
7. Copy `.env.example` to `.env.local`, fill `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, and restart Vite.
8. Sign in under **Settings**. A provisioned empty cloud workspace initializes with the labeled demonstration records. Local browser state is not silently copied to the cloud. A configured live analysis button appears only after the server confirms model configuration.

Administrators can add `viewer` memberships for read access. Users cannot self-assign PM roles. The application currently selects the user's earliest workspace membership; project switching is supported within that workspace.

## Backend guarantees

The schema includes profiles, workspaces, membership, projects, datasets, source records, findings and explicit source links, requirements and explicit finding links, immutable requirement versions/scores, review decisions, research sources, audit events, evidence requests, analysis runs, protected analysis jobs and scoring-model versions.

All browser table access is read-only and protected by membership-based RLS. Mutations go through Edge Functions that validate the session, PM role, command schema and current workspace revision. A service-only transaction updates a transport snapshot and normalized tables together. Stale revisions fail. Existing audit entries must remain unchanged; database triggers prevent updates/deletes of audit events, requirement versions, score versions, decisions and scoring models.

Local demo storage has no authentication or tamper-resistance boundary. It offers append-only UI behavior, not database-grade security. Shared protected usage requires Supabase. Live AI endpoints additionally need account-level quota and deployment monitoring appropriate to your environment.

## Verification

```sh
npm run build
npm test
npm run check:edge
npm run test:db
# With npm run dev running and Google Chrome installed:
npm run test:e2e
```

- 13 unit scenarios: scoring boundaries, unknown dimensions, model validation, decision versions, immutable audits, challenge/exclusion propagation, imports, grouped-study normalization, anti-fabrication provenance validation, duplicate analysis and project isolation.
- 10 local PostgreSQL scenarios using PGlite: migration validity, relational synchronization, optimistic locking, immutable history, RLS isolation, protected AI intermediates, denied browser writes and atomic commits. The test supplies a minimal Supabase auth/role fixture; this is not a hosted Supabase integration test.
- 16 headless Chrome scenarios: the complete evidence-to-decision workflow, persistence, CSV/XLSX ingestion, grouped-study import into a matching source project, analysis, audit filters, project switching and mobile navigation.
- Edge Function TypeScript validation using local declarations for Deno APIs. A live deployment is still required to verify account, network and provider integration.

Results and desktop/mobile screenshots are saved in `artifacts/`. The dependency audit reported zero known vulnerabilities after using the patched SheetJS distribution and current test dependencies.

## Structure

```text
src/data/seed.ts                Explicit synthetic scenario and source links
src/lib/workspace.ts            Shared versioned, auditable state transitions
src/lib/scoring.ts              Deterministic prioritization
src/lib/ingestion.ts            CSV/XLSX parsing, mapping and validation
src/lib/storage.ts              Separate local and authenticated cloud adapters
src/pages/                     Eight functional workspaces
src/components/Details.tsx      Requirement, finding and audit review dialogs
supabase/migrations/           Relational schema, RLS and atomic commit function
supabase/functions/workspace/  Authenticated PM command endpoint
supabase/functions/analyze/    Validated server-side structured AI analysis
scripts/                       Browser, PostgreSQL and backend synchronization checks
```
