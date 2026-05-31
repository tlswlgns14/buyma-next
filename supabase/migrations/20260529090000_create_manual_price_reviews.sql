create table if not exists public.manual_price_review_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default '',
  source_filename text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists manual_price_review_batches_user_created_idx
on public.manual_price_review_batches (user_id, created_at desc);

alter table public.manual_price_review_batches enable row level security;

drop policy if exists "Users can read own manual price review batches" on public.manual_price_review_batches;
create policy "Users can read own manual price review batches"
on public.manual_price_review_batches
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own manual price review batches" on public.manual_price_review_batches;
create policy "Users can insert own manual price review batches"
on public.manual_price_review_batches
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own manual price review batches" on public.manual_price_review_batches;
create policy "Users can update own manual price review batches"
on public.manual_price_review_batches
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own manual price review batches" on public.manual_price_review_batches;
create policy "Users can delete own manual price review batches"
on public.manual_price_review_batches
for delete
using (auth.uid() = user_id);

drop trigger if exists set_manual_price_review_batches_updated_at on public.manual_price_review_batches;
create trigger set_manual_price_review_batches_updated_at
before update on public.manual_price_review_batches
for each row
execute function public.set_updated_at();

create table if not exists public.manual_price_review_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  batch_id uuid not null references public.manual_price_review_batches(id) on delete cascade,
  merge_key text not null,
  buyma_product_id text not null default '',
  buyma_url text not null default '',
  title text not null default '',
  brand text not null default '',
  model_number text not null default '',
  own_price integer not null default 0,
  search_keyword text not null default '',
  search_url text not null default '',
  manual_lowest_price integer,
  manual_update_price integer,
  review_status text not null default 'pending',
  reviewed_at timestamptz,
  recheck_requested_at timestamptz,
  exported_at timestamptz,
  csv_order integer,
  csv_imported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint manual_price_review_items_status_check
    check (review_status in ('pending', 'reviewed', 'recheck')),
  constraint manual_price_review_items_batch_merge_key_key unique (batch_id, merge_key)
);

create index if not exists manual_price_review_items_user_batch_idx
on public.manual_price_review_items (user_id, batch_id, csv_order asc);

create index if not exists manual_price_review_items_user_status_idx
on public.manual_price_review_items (user_id, review_status);

alter table public.manual_price_review_items enable row level security;

drop policy if exists "Users can read own manual price review items" on public.manual_price_review_items;
create policy "Users can read own manual price review items"
on public.manual_price_review_items
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own manual price review items" on public.manual_price_review_items;
create policy "Users can insert own manual price review items"
on public.manual_price_review_items
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own manual price review items" on public.manual_price_review_items;
create policy "Users can update own manual price review items"
on public.manual_price_review_items
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own manual price review items" on public.manual_price_review_items;
create policy "Users can delete own manual price review items"
on public.manual_price_review_items
for delete
using (auth.uid() = user_id);

drop trigger if exists set_manual_price_review_items_updated_at on public.manual_price_review_items;
create trigger set_manual_price_review_items_updated_at
before update on public.manual_price_review_items
for each row
execute function public.set_updated_at();

grant select, insert, update, delete
on public.manual_price_review_batches
to authenticated;

grant select, insert, update, delete
on public.manual_price_review_batches
to service_role;

grant select, insert, update, delete
on public.manual_price_review_items
to authenticated;

grant select, insert, update, delete
on public.manual_price_review_items
to service_role;
