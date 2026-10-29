-- Segurança de produção para o Vida & Conforto.
-- Executar depois de schema.sql no Supabase SQL Editor.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  name text not null default '',
  role text not null default 'employee' check (role in ('admin', 'employee')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Compatibilidade com uma tabela profiles já existente.
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists name text default '';
alter table public.profiles add column if not exists role text default 'employee';
alter table public.profiles add column if not exists created_at timestamptz default now();
alter table public.profiles add column if not exists updated_at timestamptz default now();

alter table public.app_state add column if not exists notifications jsonb not null default '[]'::jsonb;

update public.profiles p
set email = u.email,
    name = coalesce(nullif(p.name, ''), u.raw_user_meta_data->>'name', split_part(u.email, '@', 1)),
    role = coalesce(nullif(p.role, ''), case when u.email ilike 'miguel%' then 'admin' else 'employee' end)
from auth.users u
where p.id = u.id;

alter table public.profiles enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

drop policy if exists "profiles own read" on public.profiles;
create policy "profiles own read"
on public.profiles for select
to authenticated
using (id = auth.uid());

drop policy if exists "profiles admin read" on public.profiles;
create policy "profiles admin read"
on public.profiles for select
to authenticated
using (public.is_admin());

drop policy if exists "profiles own update" on public.profiles;
create policy "profiles own update"
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "app state access" on public.app_state;

-- Todos os dados da aplicação exigem sessão. Apenas administradores escrevem
-- no estado global; funcionários podem ler o estado necessário ao seu painel.
create policy "app state authenticated read"
on public.app_state for select
to authenticated
using (true);

create policy "app state admin write"
on public.app_state for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

insert into public.profiles (id, email, name, role)
select id, email, coalesce(raw_user_meta_data->>'name', split_part(email, '@', 1)),
       case when email ilike 'miguel%' then 'admin' else 'employee' end
from auth.users
on conflict (id) do update set email = excluded.email, name = excluded.name;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'role', 'employee')
  )
  on conflict (id) do update set email = excluded.email, name = excluded.name;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();
