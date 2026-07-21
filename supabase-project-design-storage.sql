alter table public.projects
  add column if not exists prompt text,
  add column if not exists brief_json jsonb,
  add column if not exists design_project_json jsonb,
  add column if not exists version_history_json jsonb default '[]'::jsonb,
  add column if not exists active_version_id text;

create index if not exists projects_tester_updated_idx
  on public.projects (tester_id, updated_at desc);
