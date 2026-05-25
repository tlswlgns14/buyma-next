create table if not exists public.buyma_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.buyma_settings enable row level security;

drop policy if exists "Users can read own buyma settings" on public.buyma_settings;
create policy "Users can read own buyma settings"
on public.buyma_settings
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own buyma settings" on public.buyma_settings;
create policy "Users can insert own buyma settings"
on public.buyma_settings
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own buyma settings" on public.buyma_settings;
create policy "Users can update own buyma settings"
on public.buyma_settings
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop trigger if exists set_buyma_settings_updated_at on public.buyma_settings;
create trigger set_buyma_settings_updated_at
before update on public.buyma_settings
for each row
execute function public.set_updated_at();

grant select, insert, update
on public.buyma_settings
to authenticated;

grant select, insert, update, delete
on public.buyma_settings
to service_role;
