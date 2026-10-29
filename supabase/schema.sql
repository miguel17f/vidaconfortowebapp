-- Vida & Conforto — instalação completa da base de dados.
-- Pode ser executado numa base Supabase nova ou novamente numa existente.

create table if not exists public.app_state (
  id text primary key default 'default',
  clients jsonb not null default '[]'::jsonb,
  employees jsonb not null default '[]'::jsonb,
  services jsonb not null default '[]'::jsonb,
  reports jsonb not null default '[]'::jsonb,
  time_entries jsonb not null default '[]'::jsonb,
  notifications jsonb not null default '[]'::jsonb,
  company_settings jsonb not null default '{}'::jsonb,
  employee_profile jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_state add column if not exists clients jsonb not null default '[]'::jsonb;
alter table public.app_state add column if not exists employees jsonb not null default '[]'::jsonb;
alter table public.app_state add column if not exists services jsonb not null default '[]'::jsonb;
alter table public.app_state add column if not exists reports jsonb not null default '[]'::jsonb;
alter table public.app_state add column if not exists time_entries jsonb not null default '[]'::jsonb;
alter table public.app_state add column if not exists notifications jsonb not null default '[]'::jsonb;
alter table public.app_state add column if not exists company_settings jsonb not null default '{}'::jsonb;
alter table public.app_state add column if not exists employee_profile jsonb not null default '{}'::jsonb;
alter table public.app_state add column if not exists updated_at timestamptz not null default now();

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  name text not null default '',
  role text not null default 'employee' check (role in ('admin', 'employee')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists name text not null default '';
alter table public.profiles add column if not exists role text not null default 'employee';
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

update public.profiles p
set email = u.email,
    name = coalesce(nullif(p.name, ''), u.raw_user_meta_data->>'name', split_part(u.email, '@', 1)),
    role = case when p.role = 'admin' then 'admin' else 'employee' end,
    updated_at = now()
from auth.users u
where p.id = u.id;

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

alter table public.app_state enable row level security;
alter table public.profiles enable row level security;

drop policy if exists "app state access" on public.app_state;
drop policy if exists "app state authenticated read" on public.app_state;
drop policy if exists "app state admin write" on public.app_state;
create policy "app state authenticated read" on public.app_state for select to authenticated using (true);
create policy "app state admin write" on public.app_state for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "profiles own read" on public.profiles;
drop policy if exists "profiles admin read" on public.profiles;
drop policy if exists "profiles own update" on public.profiles;
create policy "profiles own read" on public.profiles for select to authenticated using (id = auth.uid());
create policy "profiles admin read" on public.profiles for select to authenticated using (public.is_admin());
create policy "profiles own update" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    case when new.raw_user_meta_data->>'role' = 'admin' then 'admin' else 'employee' end
  )
  on conflict (id) do update set email = excluded.email, name = excluded.name, updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

insert into public.profiles (id, email, name, role)
select id, email, coalesce(raw_user_meta_data->>'name', split_part(email, '@', 1)),
       case when raw_user_meta_data->>'role' = 'admin' then 'admin' else 'employee' end
from auth.users where email is not null
on conflict (id) do update set email = excluded.email, updated_at = now();

insert into public.app_state (id) values ('default') on conflict (id) do nothing;
