alter table public.users
add column if not exists can_use_competitor_prices boolean not null default false;
