grant select, insert, update
on public.users
to authenticated;

grant select, insert, update, delete
on public.users
to service_role;

grant select, insert, update
on public.competitor_price_settings
to authenticated;

grant select, insert, update, delete
on public.competitor_price_settings
to service_role;

grant select, insert, update, delete
on public.competitor_price_products
to authenticated;

grant select, insert, update, delete
on public.competitor_price_products
to service_role;
