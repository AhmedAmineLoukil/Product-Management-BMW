-- Protected workspace snapshots are a transport cache. Relational records and
-- immutable versions/audit events are synchronized atomically by the commit RPC.
create extension if not exists pgcrypto;
create table public.profiles(id uuid primary key references auth.users(id), display_name text, created_at timestamptz not null default now());
create table public.workspaces(id uuid primary key default gen_random_uuid(), name text not null default 'Product intelligence', revision integer not null default -1, snapshot jsonb, created_at timestamptz not null default now());
create table public.workspace_members(workspace_id uuid references public.workspaces(id), user_id uuid references public.profiles(id), role text not null check(role in ('pm','viewer')), created_at timestamptz not null default now(), primary key(workspace_id,user_id));
create table public.projects(workspace_id uuid references public.workspaces(id), id text, name text not null, derivative text not null, market text not null, horizon text, primary key(workspace_id,id));
create table public.datasets(workspace_id uuid,id text,project_id text,name text not null,type text not null,synthetic boolean not null,status text not null,created_at timestamptz not null,metadata jsonb not null,primary key(workspace_id,id),foreign key(workspace_id,project_id) references public.projects(workspace_id,id));
create table public.source_records(workspace_id uuid,id text,dataset_id text,source_row integer,source_sheet text,content text,original_fields jsonb not null,primary key(workspace_id,id),foreign key(workspace_id,dataset_id) references public.datasets(workspace_id,id));
create table public.findings(workspace_id uuid,id text,project_id text,status text not null,category text not null,confidence numeric check(confidence between 0 and 100),payload jsonb not null,primary key(workspace_id,id),foreign key(workspace_id,project_id) references public.projects(workspace_id,id));
create table public.finding_source_links(workspace_id uuid,finding_id text,source_record_id text,relationship text check(relationship in ('supports','contradicts')),primary key(workspace_id,finding_id,source_record_id,relationship),foreign key(workspace_id,finding_id) references public.findings(workspace_id,id),foreign key(workspace_id,source_record_id) references public.source_records(workspace_id,id));
create table public.requirements(workspace_id uuid,id text,project_id text,title text not null,statement text not null,status text not null,version integer not null,updated_at timestamptz not null,payload jsonb not null,primary key(workspace_id,id),foreign key(workspace_id,project_id) references public.projects(workspace_id,id));
create table public.requirement_finding_links(workspace_id uuid,requirement_id text,finding_id text,primary key(workspace_id,requirement_id,finding_id),foreign key(workspace_id,requirement_id) references public.requirements(workspace_id,id),foreign key(workspace_id,finding_id) references public.findings(workspace_id,id));
create table public.scoring_model_versions(workspace_id uuid references public.workspaces(id),version integer,created_at timestamptz not null,weights jsonb not null,thresholds jsonb not null,primary key(workspace_id,version));
create table public.requirement_versions(workspace_id uuid,requirement_id text,version integer,payload jsonb not null,primary key(workspace_id,requirement_id,version),foreign key(workspace_id,requirement_id) references public.requirements(workspace_id,id));
create table public.requirement_scores(workspace_id uuid,requirement_id text,version integer,model_version integer,scores jsonb not null,priority_override text,created_at timestamptz not null default now(),primary key(workspace_id,requirement_id,version),foreign key(workspace_id,requirement_id,version) references public.requirement_versions(workspace_id,requirement_id,version),foreign key(workspace_id,model_version) references public.scoring_model_versions(workspace_id,version));
create table public.analysis_runs(workspace_id uuid,id text,project_id text,created_at timestamptz not null,mode text not null,payload jsonb not null,primary key(workspace_id,id),foreign key(workspace_id,project_id) references public.projects(workspace_id,id));
create table public.evidence_requests(workspace_id uuid,id text,requirement_id text,status text not null,request_text text not null,created_at timestamptz not null,primary key(workspace_id,id),foreign key(workspace_id,requirement_id) references public.requirements(workspace_id,id));
create table public.research_sources(workspace_id uuid,id text,source_record_id text,title text,url text,publication_date text,retrieval_date text,quality text not null default 'User-supplied; unverified',payload jsonb not null,primary key(workspace_id,id),foreign key(workspace_id,source_record_id) references public.source_records(workspace_id,id));
create table public.audit_events(workspace_id uuid,id text,project_id text,at timestamptz not null,actor_type text not null,actor_id text not null,action text not null,entity_type text not null,entity_id text not null,previous_value jsonb,new_value jsonb,rationale text not null,related_ids jsonb not null,requirement_version integer,analysis_run_id text,primary key(workspace_id,id),foreign key(workspace_id,project_id) references public.projects(workspace_id,id));
create table public.review_decisions(workspace_id uuid,id text,requirement_id text,requirement_version integer,actor_id text not null,decision text not null,rationale text not null,created_at timestamptz not null,primary key(workspace_id,id),foreign key(workspace_id,id) references public.audit_events(workspace_id,id),foreign key(workspace_id,requirement_id) references public.requirements(workspace_id,id));
create index audit_project_time on public.audit_events(workspace_id,project_id,at desc);
create index requirements_project_status on public.requirements(workspace_id,project_id,status);
create index source_dataset on public.source_records(workspace_id,dataset_id);
create index findings_project on public.findings(workspace_id,project_id);
create index membership_user on public.workspace_members(user_id);

create function public.is_workspace_member(w uuid) returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from workspace_members where workspace_id=w and user_id=auth.uid())$$;
revoke all on function public.is_workspace_member(uuid) from public;
grant execute on function public.is_workspace_member(uuid) to authenticated;
alter table public.profiles enable row level security;
create policy profile_self_read on public.profiles for select to authenticated using(id=auth.uid());
alter table public.workspaces enable row level security;
create policy workspace_read on public.workspaces for select to authenticated using(public.is_workspace_member(id));
alter table public.workspace_members enable row level security;
create policy member_read on public.workspace_members for select to authenticated using(user_id=auth.uid());
do $$declare t text;begin foreach t in array array['projects','datasets','source_records','findings','finding_source_links','requirements','requirement_finding_links','scoring_model_versions','requirement_versions','requirement_scores','analysis_runs','evidence_requests','research_sources','audit_events','review_decisions'] loop
execute format('alter table public.%I enable row level security',t);
execute format('create policy workspace_read on public.%I for select to authenticated using(public.is_workspace_member(workspace_id))',t);
end loop;end$$;
-- No INSERT/UPDATE/DELETE policies. Browser clients can only read their workspace.
revoke all on all tables in schema public from anon,authenticated;
grant select on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
create function public.prevent_history_mutation() returns trigger language plpgsql as $$begin raise exception 'History is append-only';end$$;
create trigger immutable_audit before update or delete on public.audit_events for each row execute function public.prevent_history_mutation();
create trigger immutable_versions before update or delete on public.requirement_versions for each row execute function public.prevent_history_mutation();
create trigger immutable_scores before update or delete on public.requirement_scores for each row execute function public.prevent_history_mutation();
create trigger immutable_decisions before update or delete on public.review_decisions for each row execute function public.prevent_history_mutation();
create trigger immutable_models before update or delete on public.scoring_model_versions for each row execute function public.prevent_history_mutation();

create function public.commit_workspace(p_workspace uuid,p_expected integer,p_snapshot jsonb) returns void language plpgsql security definer set search_path=public as $$
declare current_rev integer; previous jsonb; x jsonb; y jsonb; link text; model_version integer;
begin
 select revision,snapshot into current_rev,previous from workspaces where id=p_workspace for update;
 if not found then raise exception 'Workspace not found';end if;
 if current_rev<>p_expected then raise exception 'Concurrent modification: reload the workspace';end if;
 if (p_snapshot->>'revision')::integer<>current_rev+1 then raise exception 'Invalid revision';end if;
 -- Historical audit entries must remain byte-for-byte equivalent.
 if previous is not null then
  for x in select value from jsonb_array_elements(previous->'audit') loop
   if not exists(select 1 from jsonb_array_elements(p_snapshot->'audit') e where e->>'id'=x->>'id' and e=x) then raise exception 'Audit history cannot be changed or removed';end if;
  end loop;
 end if;
 for x in select value from jsonb_array_elements(p_snapshot->'projects') loop
 insert into projects values(p_workspace,x->>'id',x->>'name',x->>'derivative',x->>'market',x->>'horizon') on conflict(workspace_id,id) do nothing;
 end loop;
 x:=p_snapshot->'model';model_version:=(x->>'version')::integer;
 insert into scoring_model_versions values(p_workspace,model_version,(x->>'updatedAt')::timestamptz,x->'weights',x->'thresholds') on conflict do nothing;
 for x in select value from jsonb_array_elements(p_snapshot->'datasets') loop
 insert into datasets values(p_workspace,x->>'id',x->>'projectId',x->>'name',x->>'type',(x->>'synthetic')::boolean,x->>'status',(x->>'createdAt')::timestamptz,x-'records') on conflict(workspace_id,id) do nothing;
 for y in select value from jsonb_array_elements(x->'records') loop
 insert into source_records values(p_workspace,y->>'id',x->>'id',(y->>'row')::integer,y->>'sheet',y->>'content',y->'fields') on conflict do nothing;
 if x->>'type'='External research' then insert into research_sources values(p_workspace,y->>'id',y->>'id',y->'fields'->>'title',y->'fields'->>'url',y->'fields'->>'publication_date',y->'fields'->>'retrieval_date','User-supplied; unverified',y) on conflict do nothing;end if;
 end loop;end loop;
 for x in select value from jsonb_array_elements(p_snapshot->'findings') loop
 insert into findings values(p_workspace,x->>'id',x->>'projectId',x->>'status',x->>'category',(x->>'confidence')::numeric,x) on conflict(workspace_id,id) do update set status=excluded.status,confidence=excluded.confidence,payload=excluded.payload;
 for link in select jsonb_array_elements_text(x->'sources') loop insert into finding_source_links values(p_workspace,x->>'id',link,'supports') on conflict do nothing;end loop;
 for link in select jsonb_array_elements_text(x->'contradictions') loop insert into finding_source_links values(p_workspace,x->>'id',link,'contradicts') on conflict do nothing;end loop;
 end loop;
 for x in select value from jsonb_array_elements(p_snapshot->'requirements') loop
 insert into requirements values(p_workspace,x->>'id',x->>'projectId',x->>'title',x->>'statement',x->>'status',(x->>'version')::integer,(x->>'updatedAt')::timestamptz,x-'history') on conflict(workspace_id,id) do update set title=excluded.title,statement=excluded.statement,status=excluded.status,version=excluded.version,updated_at=excluded.updated_at,payload=excluded.payload;
 for link in select jsonb_array_elements_text(x->'findings') loop insert into requirement_finding_links values(p_workspace,x->>'id',link) on conflict do nothing;end loop;
 for y in select value from jsonb_array_elements(x->'history') loop
 insert into scoring_model_versions values(p_workspace,(y->>'modelVersion')::integer,(y->>'at')::timestamptz,y->'weights',y->'thresholds') on conflict do nothing;
 insert into requirement_versions values(p_workspace,x->>'id',(y->>'version')::integer,y) on conflict do nothing;
 insert into requirement_scores values(p_workspace,x->>'id',(y->>'version')::integer,(y->>'modelVersion')::integer,y->'scores',y->>'priorityOverride',(y->>'at')::timestamptz) on conflict do nothing;
 end loop;
 insert into requirement_versions values(p_workspace,x->>'id',(x->>'version')::integer,x-'history') on conflict do nothing;
 insert into requirement_scores values(p_workspace,x->>'id',(x->>'version')::integer,model_version,x->'scores',x->>'priorityOverride',(x->>'updatedAt')::timestamptz) on conflict do nothing;
 end loop;
 for x in select value from jsonb_array_elements(p_snapshot->'runs') loop insert into analysis_runs values(p_workspace,x->>'id',x->>'projectId',(x->>'at')::timestamptz,x->>'mode',x) on conflict do nothing;end loop;
 for x in select value from jsonb_array_elements(p_snapshot->'requests') loop insert into evidence_requests values(p_workspace,x->>'id',x->>'requirementId',x->>'status',x->>'text',(x->>'createdAt')::timestamptz) on conflict(workspace_id,id) do update set status=excluded.status;end loop;
 for x in select value from jsonb_array_elements(p_snapshot->'audit') loop
 insert into audit_events values(p_workspace,x->>'id',x->>'projectId',(x->>'at')::timestamptz,x->>'actor',x->>'actorId',x->>'action',x->>'entityType',x->>'entityId',x->'before',x->'after',x->>'rationale',x->'relatedIds',(x->>'version')::integer,x->>'runId') on conflict do nothing;
 if x->>'entityType'='Requirement' and x->>'action' in ('Requirement approved','Requirement rejected','Status changed','More evidence requested') then
 insert into review_decisions values(p_workspace,x->>'id',x->>'entityId',(x->>'version')::integer,x->>'actorId',x->'after'->>'status',x->>'rationale',(x->>'at')::timestamptz) on conflict do nothing;end if;
 end loop;
 update workspaces set snapshot=p_snapshot,revision=(p_snapshot->>'revision')::integer where id=p_workspace;
end$$;
revoke all on function public.commit_workspace(uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.commit_workspace(uuid,integer,jsonb) to service_role;
-- Explicit administrator provisioning is required; users cannot self-assign PM roles.
-- After creating an auth user, insert profiles, workspaces and workspace_members.
