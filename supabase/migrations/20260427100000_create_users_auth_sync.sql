create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  username text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.users enable row level security;

drop policy if exists "Users can read own profile" on public.users;
create policy "Users can read own profile"
on public.users
for select
to authenticated
using (auth.uid() = id);

drop policy if exists "Users can insert own profile" on public.users;
create policy "Users can insert own profile"
on public.users
for insert
to authenticated
with check (auth.uid() = id);

drop policy if exists "Users can update own profile" on public.users;
create policy "Users can update own profile"
on public.users
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_users_updated_at on public.users;
create trigger set_users_updated_at
before update on public.users
for each row
execute function public.set_updated_at();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, username, phone)
  values (
    new.id,
    coalesce(new.email, ''),
    nullif(new.raw_user_meta_data ->> 'username', ''),
    nullif(new.raw_user_meta_data ->> 'phone', '')
  )
  on conflict (id) do update
  set
    email = excluded.email,
    username = coalesce(excluded.username, public.users.username),
    phone = coalesce(excluded.phone, public.users.phone),
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_auth_user();

insert into public.users (id, email, username, phone, created_at, updated_at)
select
  id,
  coalesce(email, ''),
  nullif(raw_user_meta_data ->> 'username', ''),
  nullif(raw_user_meta_data ->> 'phone', ''),
  created_at,
  now()
from auth.users
on conflict (id) do update
set
  email = excluded.email,
  username = coalesce(excluded.username, public.users.username),
  phone = coalesce(excluded.phone, public.users.phone),
  updated_at = now();
