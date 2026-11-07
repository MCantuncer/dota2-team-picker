-- The admin Players page: how many players have signed in with Steam, per day, and who joined last.
-- Read only, nothing new is stored. Only admins (profiles.user_type = 'admin') may call these; anyone
-- else gets an error, so the page fails closed. Days are counted in Turkey time (Europe/Istanbul),
-- the admin's own clock.

-- One row: the total, today's signups, the last 7 days, and one count per day for the last 14 days,
-- oldest first, ending today. first_day is the date of per_day[1].
create function public.admin_signup_stats()
returns table (
  total integer,
  today integer,
  last_7_days integer,
  first_day date,
  per_day integer[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  today_tr date := (now() at time zone 'Europe/Istanbul')::date;
begin
  if not exists (
    select 1 from public.profiles p where p.id = (select auth.uid()) and p.user_type = 'admin'
  ) then
    raise exception 'Only admins can see player numbers' using errcode = '42501';
  end if;

  return query
  with players as (
    select (p.created_at at time zone 'Europe/Istanbul')::date as day
    from public.profiles p
    where p.steam_id is not null
  ),
  days as (
    select today_tr - i as day from generate_series(0, 13) i
  )
  select
    (select count(*) from players)::integer,
    (select count(*) from players where day = today_tr)::integer,
    (select count(*) from players where day > today_tr - 7)::integer,
    today_tr - 13,
    (select array_agg((select count(*) from players pl where pl.day = d.day)::integer order by d.day) from days d);
end;
$$;

-- The newest Steam players first, max_rows at a time (1 to 50). For the next page pass the last row's
-- joined_at and user_id as before_at and before_id. hero_count is how many different heroes they have in
-- My Heroes across all positions.
create function public.admin_newest_players(
  max_rows integer default 20,
  before_at timestamptz default null,
  before_id uuid default null
)
returns table (
  user_id uuid,
  display_name text,
  avatar_url text,
  steam_id text,
  rank_tier smallint,
  joined_at timestamptz,
  hero_count integer
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
    raise exception 'Only admins can see player numbers' using errcode = '42501';
  end if;
  if max_rows is null or max_rows < 1 or max_rows > 50 then
    raise exception 'max_rows must be between 1 and 50' using errcode = '22023';
  end if;
  if (before_at is null) <> (before_id is null) then
    raise exception 'Pass both before_at and before_id, or neither' using errcode = '22023';
  end if;

  return query
  select p.id, p.display_name, p.avatar_url, p.steam_id, p.rank_tier, p.created_at,
    (select count(distinct f.hero_id) from public.favorite_heroes f where f.user_id = p.id)::integer
  from public.profiles p
  where p.steam_id is not null
    and (before_at is null or (p.created_at, p.id) < (before_at, before_id))
  order by p.created_at desc, p.id desc
  limit max_rows;
end;
$$;

revoke execute on function public.admin_signup_stats, public.admin_newest_players from public, anon;
grant execute on function public.admin_signup_stats, public.admin_newest_players to authenticated;
