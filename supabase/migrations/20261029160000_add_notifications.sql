alter table public.app_state
  add column if not exists notifications jsonb not null default '[]'::jsonb;
