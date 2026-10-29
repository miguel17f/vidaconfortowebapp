-- Estrutura persistente da Vida & Conforto.
-- Executar no Supabase SQL Editor.

create table if not exists public.app_state (
  id text primary key default 'default',
  clients jsonb not null default '[]'::jsonb,
  employees jsonb not null default '[]'::jsonb,
  services jsonb not null default '[]'::jsonb,
  reports jsonb not null default '[]'::jsonb,
  time_entries jsonb not null default '[]'::jsonb,
  company_settings jsonb not null default '{}'::jsonb,
  employee_profile jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_state add column if not exists company_settings jsonb not null default '{}'::jsonb;
alter table public.app_state add column if not exists employee_profile jsonb not null default '{}'::jsonb;

alter table public.app_state enable row level security;

drop policy if exists "app state access" on public.app_state;
create policy "app state access"
on public.app_state
for all
to anon, authenticated
using (true)
with check (true);

insert into public.app_state (id)
values ('default')
on conflict (id) do nothing;
