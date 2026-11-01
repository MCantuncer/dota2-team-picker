-- One daily budget for OpenDota calls made by the edge functions. Without an API key,
-- OpenDota allows about 2,000 calls a day per IP, and edge function IPs are shared, so
-- every caller takes calls from this budget first and stays well under that.

create table public.opendota_calls (
  -- The UTC day.
  day date primary key,
  calls integer not null check (calls >= 0)
);

alter table public.opendota_calls enable row level security;
revoke all on public.opendota_calls from anon, authenticated;

-- Takes `wanted` calls from today's budget of `daily_cap`. Returns true when they fit,
-- false (taking nothing) when they don't. One statement, so two callers at once can't
-- both take the last calls. Service role only.
create function public.take_opendota_calls(wanted integer, daily_cap integer default 800)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with today as (select (now() at time zone 'utc')::date as day),
  taken as (
    insert into public.opendota_calls (day, calls)
    select day, wanted from today where wanted between 1 and daily_cap
    on conflict (day) do update set calls = public.opendota_calls.calls + excluded.calls
      where public.opendota_calls.calls + excluded.calls <= daily_cap
    returning 1
  )
  select exists (select 1 from taken)
$$;

revoke execute on function public.take_opendota_calls from public, anon, authenticated;
grant execute on function public.take_opendota_calls to service_role;
