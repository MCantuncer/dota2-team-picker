-- STRATZ lets a token be used from 2 addresses per 15 minutes. The hero data refresh (GitHub Actions)
-- and the matchup-builds lookups (edge functions) share one token, so they take turns:
--   - while the refresh runs, and for 15 minutes after, the lookups leave STRATZ alone;
--   - the refresh waits 15 minutes after the last lookup call before its own first call;
--   - a 429 a lookup gets holds every lookup back until STRATZ said to try again.
-- One clock (the database's) decides all of it.
create table public.stratz_refresh (
  -- One row.
  id boolean primary key default true check (id),
  started_at timestamptz,
  finished_at timestamptz,
  -- The last time a lookup took STRATZ calls.
  last_lookup_at timestamptz,
  -- Lookups wait until this after a 429.
  busy_until timestamptz
);

alter table public.stratz_refresh enable row level security;
revoke all on public.stratz_refresh from anon, authenticated;

insert into public.stratz_refresh (id) values (true);

-- Marks the refresh as started (running true) or finished. On start, returns when the refresh may make
-- its first STRATZ call: 15 minutes after the last lookup call, or now. Called by the refresh job.
create function public.mark_stratz_refresh(running boolean)
returns timestamptz
language sql
set search_path = ''
as $$
  update public.stratz_refresh
  set started_at = case when running then now() else started_at end,
    finished_at = case when running then null else now() end
  where id
  returning greatest(now(), coalesce(last_lookup_at + interval '15 minutes', now()));
$$;

-- When the lookups may use STRATZ again, or null when they may now. A refresh marked as started and not
-- finished counts as running for 90 minutes (the job's own limit is 45), so a killed job can't hold the
-- lookups back for long. While it runs the end is unknown, so the answer is 15 minutes from now.
create function public.stratz_free_at()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select nullif(greatest(
    case when started_at > now() - interval '90 minutes' and (finished_at is null or finished_at < started_at)
      then now() + interval '15 minutes' end,
    finished_at + interval '15 minutes',
    busy_until,
    now()
  ), now())
  from public.stratz_refresh
  where id;
$$;

-- A lookup got a 429: every lookup waits until `until`, at most an hour from now.
create function public.note_stratz_busy(until timestamptz)
returns void
language sql
set search_path = ''
as $$
  update public.stratz_refresh
  set busy_until = greatest(busy_until, least(until, now() + interval '1 hour'))
  where id;
$$;

-- As before (20261103041500_matchup_guides), and a taken call also notes the time, for the refresh to wait.
create or replace function public.take_stratz_calls(wanted integer, hourly_cap integer default 600)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with this_hour as (select date_trunc('hour', now()) as hour),
  taken as (
    insert into public.stratz_calls (hour, calls)
    select hour, wanted from this_hour where wanted between 1 and hourly_cap
    on conflict (hour) do update set calls = public.stratz_calls.calls + excluded.calls
      where public.stratz_calls.calls + excluded.calls <= hourly_cap
    returning 1
  ),
  -- Runs although nothing reads it, as every data-modifying WITH does.
  noted as (
    update public.stratz_refresh set last_lookup_at = now()
    where id and exists (select 1 from taken)
  )
  select exists (select 1 from taken)
$$;

revoke execute on function public.mark_stratz_refresh, public.stratz_free_at, public.note_stratz_busy
  from public, anon, authenticated;
grant execute on function public.mark_stratz_refresh, public.stratz_free_at, public.note_stratz_busy
  to service_role;
