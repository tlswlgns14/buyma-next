create table if not exists public.competitor_price_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  owner_name text not null default 'sonokoro',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.competitor_price_settings enable row level security;

drop policy if exists "Users can read own competitor price settings" on public.competitor_price_settings;
create policy "Users can read own competitor price settings"
on public.competitor_price_settings
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own competitor price settings" on public.competitor_price_settings;
create policy "Users can insert own competitor price settings"
on public.competitor_price_settings
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own competitor price settings" on public.competitor_price_settings;
create policy "Users can update own competitor price settings"
on public.competitor_price_settings
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop trigger if exists set_competitor_price_settings_updated_at on public.competitor_price_settings;
create trigger set_competitor_price_settings_updated_at
before update on public.competitor_price_settings
for each row
execute function public.set_updated_at();

create table if not exists public.competitor_price_products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  merge_key text not null,
  buyma_product_id text not null default '',
  buyma_url text not null default '',
  title text not null default '',
  brand text not null default '',
  model_number text not null default '',
  own_price integer not null default 0,
  search_keyword text not null default '',
  search_url text not null default '',
  status text not null default 'active',
  last_checked_at timestamptz,
  last_search_url text,
  reference_price integer,
  lower_competitors jsonb not null default '[]'::jsonb,
  last_results jsonb not null default '[]'::jsonb,
  error text,
  next_check_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint competitor_price_products_status_check
    check (status in ('active', 'paused', 'missing', 'ended')),
  constraint competitor_price_products_user_merge_key_key unique (user_id, merge_key)
);

create index if not exists competitor_price_products_user_status_idx
on public.competitor_price_products (user_id, status);

create index if not exists competitor_price_products_next_check_idx
on public.competitor_price_products (status, next_check_at);

alter table public.competitor_price_products enable row level security;

drop policy if exists "Users can read own competitor price products" on public.competitor_price_products;
create policy "Users can read own competitor price products"
on public.competitor_price_products
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own competitor price products" on public.competitor_price_products;
create policy "Users can insert own competitor price products"
on public.competitor_price_products
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own competitor price products" on public.competitor_price_products;
create policy "Users can update own competitor price products"
on public.competitor_price_products
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own competitor price products" on public.competitor_price_products;
create policy "Users can delete own competitor price products"
on public.competitor_price_products
for delete
to authenticated
using (auth.uid() = user_id);

drop trigger if exists set_competitor_price_products_updated_at on public.competitor_price_products;
create trigger set_competitor_price_products_updated_at
before update on public.competitor_price_products
for each row
execute function public.set_updated_at();
