-- The live matchup lookup (matchup-builds function, Game Story skill order plan): after a draft,
-- the high-rank STRATZ games of each of our heroes against each enemy, cached per hero,
-- position, enemy and game version for 7 days, so repeat drafts cost no STRATZ calls.
-- Plus the limits around it: one shared hourly STRATZ budget, 20 lookups per user per hour,
-- and a claim so two drafts at once don't fetch the same slice twice.

create table public.matchup_guides (
  hero_id integer not null check (hero_id > 0),
  position smallint not null check (position between 1 and 5),
  enemy_id integer not null check (enemy_id > 0 and enemy_id <> hero_id),
  game_version integer not null check (game_version > 0),
  -- The games behind every number on the card: [{ match, account, won, level, points }].
  -- Empty when STRATZ had none, which is cached too.
  games jsonb not null check (jsonb_typeof(games) = 'array'),
  fetched_at timestamptz not null default now(),
  primary key (hero_id, position, enemy_id, game_version)
);

create index matchup_guides_fetched_at_idx on public.matchup_guides (fetched_at);

alter table public.matchup_guides enable row level security;
revoke all on public.matchup_guides from anon, authenticated;

-- Slices being fetched right now. A claim older than 60 seconds is stale (its function died)
-- and can be taken again.
create table public.matchup_fetches (
  hero_id integer not null,
  position smallint not null,
  enemy_id integer not null,
  game_version integer not null,
  claimed_at timestamptz not null default now(),
  primary key (hero_id, position, enemy_id, game_version)
);

alter table public.matchup_fetches enable row level security;
revoke all on public.matchup_fetches from anon, authenticated;

-- Claims the slices in `wanted` (a jsonb array of { hero, position, enemy }) for `version`,
-- skipping ones another call claimed in the last 60 seconds. Returns the claimed ones in
-- the same shape. Service role only.
create function public.claim_matchup_fetches(wanted jsonb, version integer)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  with asked as (
    select distinct (w ->> 'hero')::integer as hero_id, (w ->> 'position')::smallint as position,
      (w ->> 'enemy')::integer as enemy_id
    from jsonb_array_elements(case when jsonb_typeof(wanted) = 'array' then wanted else '[]'::jsonb end) w
    limit 25
  ),
  claimed as (
    insert into public.matchup_fetches as f (hero_id, position, enemy_id, game_version)
    select hero_id, position, enemy_id, version from asked
    on conflict (hero_id, position, enemy_id, game_version) do update set claimed_at = now()
      where f.claimed_at < now() - interval '60 seconds'
    returning f.hero_id, f.position, f.enemy_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('hero', hero_id, 'position', position, 'enemy', enemy_id)), '[]'::jsonb)
  from claimed
$$;

-- Saves fetched slices (a jsonb array of { hero, position, enemy, games }) and drops their
-- claims. Returns how many were saved. Service role only.
create function public.save_matchup_guides(slices jsonb, version integer)
returns integer
language sql
security definer
set search_path = ''
as $$
  with rows as (
    select (s ->> 'hero')::integer as hero_id, (s ->> 'position')::smallint as position,
      (s ->> 'enemy')::integer as enemy_id, s -> 'games' as games
    from jsonb_array_elements(case when jsonb_typeof(slices) = 'array' then slices else '[]'::jsonb end) s
    limit 25
  ),
  saved as (
    insert into public.matchup_guides (hero_id, position, enemy_id, game_version, games)
    select hero_id, position, enemy_id, version, games from rows
    on conflict (hero_id, position, enemy_id, game_version)
      do update set games = excluded.games, fetched_at = now()
    returning hero_id, position, enemy_id
  ),
  released as (
    delete from public.matchup_fetches f using saved s
    where f.hero_id = s.hero_id and f.position = s.position and f.enemy_id = s.enemy_id
      and f.game_version = version
    returning 1
  )
  select count(*)::integer from saved
$$;

-- One hourly budget for STRATZ calls from the edge functions, under the token's hourly limit
-- with room left for the data refresh. Same shape as take_opendota_calls.
create table public.stratz_calls (
  -- The UTC hour.
  hour timestamptz primary key,
  calls integer not null check (calls >= 0)
);

alter table public.stratz_calls enable row level security;
revoke all on public.stratz_calls from anon, authenticated;

create function public.take_stratz_calls(wanted integer, hourly_cap integer default 600)
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
  )
  select exists (select 1 from taken)
$$;

-- Lookups per signed-in user, for the 20 per hour limit.
create table public.matchup_lookups (
  user_id uuid not null references auth.users (id) on delete cascade,
  looked_up_at timestamptz not null default now()
);

create index matchup_lookups_user_idx on public.matchup_lookups (user_id, looked_up_at);

alter table public.matchup_lookups enable row level security;
revoke all on public.matchup_lookups from anon, authenticated;

-- Takes one lookup for `who` when they made fewer than `hourly_cap` in the last hour.
-- The function passes the caller's id from their verified token. A lookup answered fully
-- from the cache does not call this. Service role only.
create function public.take_matchup_lookup(who uuid, hourly_cap integer default 20)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- One caller per user at a time, so two tabs can't both take the last lookup.
  perform pg_advisory_xact_lock(hashtextextended('matchup_lookup:' || who::text, 0));
  if (select count(*) from public.matchup_lookups
      where user_id = who and looked_up_at > now() - interval '1 hour') >= hourly_cap then
    return false;
  end if;
  insert into public.matchup_lookups (user_id) values (who);
  return true;
end;
$$;

-- Old rows go once a day: cache older than 14 days (7 days is fresh, the rest is kept as a
-- fallback while STRATZ is down), lookups and budget rows older than a day, stale claims.
create function public.forget_old_matchups()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.matchup_guides where fetched_at < now() - interval '14 days';
  delete from public.matchup_lookups where looked_up_at < now() - interval '1 day';
  delete from public.stratz_calls where hour < now() - interval '1 day';
  delete from public.matchup_fetches where claimed_at < now() - interval '1 hour';
$$;

revoke execute on function public.claim_matchup_fetches, public.save_matchup_guides, public.take_stratz_calls,
  public.take_matchup_lookup, public.forget_old_matchups from public, anon, authenticated;
grant execute on function public.claim_matchup_fetches, public.save_matchup_guides, public.take_stratz_calls,
  public.take_matchup_lookup to service_role;

select cron.schedule('forget-old-matchups', '17 4 * * *', 'select public.forget_old_matchups()');
