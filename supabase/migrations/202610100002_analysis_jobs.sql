create table public.analysis_jobs(
  id text primary key,
  workspace_id uuid not null references public.workspaces(id),
  project_id text not null,
  dataset_ids jsonb not null,
  workspace_revision integer not null,
  stage text not null check(stage in ('extracting','clustering','generating','committing','complete','failed')),
  progress integer not null check(progress between 0 and 100),
  message text not null,
  provider_response_id text,
  input_snapshot jsonb not null,
  intermediate jsonb not null default '{}'::jsonb,
  result jsonb,
  error text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(workspace_id,project_id) references public.projects(workspace_id,id)
);
create index analysis_jobs_workspace_time on public.analysis_jobs(workspace_id,created_at desc);
alter table public.analysis_jobs enable row level security;
-- Raw records and model intermediates stay server-side.
revoke all on public.analysis_jobs from anon,authenticated;
grant all on public.analysis_jobs to service_role;
