alter table public.competitor_price_products
add column if not exists csv_order integer,
add column if not exists csv_imported_at timestamptz;

create index if not exists competitor_price_products_csv_order_idx
on public.competitor_price_products (user_id, csv_imported_at desc, csv_order asc);
