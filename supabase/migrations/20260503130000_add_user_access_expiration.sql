alter table public.users
add column if not exists approval_status text;

update public.users
set approval_status = 'pending'
where approval_status is null;

alter table public.users
alter column approval_status set default 'pending',
alter column approval_status set not null;

do $$
begin
  alter table public.users
  add constraint users_approval_status_check
  check (approval_status in ('pending', 'approved', 'rejected'));
exception
  when duplicate_object then null;
end $$;

alter table public.users
add column if not exists approved_at timestamptz;

alter table public.users
add column if not exists access_expires_at timestamptz;

update public.users
set access_expires_at = created_at + interval '7 days'
where access_expires_at is null;

alter table public.users
alter column access_expires_at set default (now() + interval '7 days'),
alter column access_expires_at set not null;
