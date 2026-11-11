-- Data Status (admin page): how far the matchup backfill has come. One row per hero and position
-- in the cache for `version`: the enemies cached, how many of them are fresh (fetched in the last
-- 7 days, the lookup's FRESH_DAYS), and for the page's pace how many were fetched in the last day
-- and how many go stale in the next day (fetched 6 to 7 days ago), plus the latest fetch. The page
-- compares this with the backfill plan (the 10 most played heroes of each position against every enemy).
-- The games jsonb is never read, so the count stays cheap on a large cache.
-- Admins only; anyone else gets an error, so the page fails closed.
create function public.admin_matchup_fill(version integer)
returns table (
  hero_id integer,
  "position" smallint,
  slices integer,
  fresh integer,
  last_day integer,
  expiring integer,
  last_fetched timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profiles p where p.id = (select auth.uid()) and p.user_type = 'admin'
  ) then
    raise exception 'Only admins can see the data status' using errcode = '42501';
  end if;
  if version is null or version <= 0 then
    raise exception 'version must be above 0' using errcode = '22023';
  end if;

  return query
  select
    m.hero_id,
    m.position,
    count(*)::integer,
    (count(*) filter (where m.fetched_at >= now() - interval '7 days'))::integer,
    (count(*) filter (where m.fetched_at >= now() - interval '1 day'))::integer,
    (count(*) filter (
      where m.fetched_at >= now() - interval '7 days' and m.fetched_at < now() - interval '6 days'
    ))::integer,
    max(m.fetched_at)
  from public.matchup_guides m
  where m.game_version = version
  group by m.hero_id, m.position
  order by m.hero_id, m.position;
end;
$$;

revoke execute on function public.admin_matchup_fill from public, anon;
grant execute on function public.admin_matchup_fill to authenticated;
