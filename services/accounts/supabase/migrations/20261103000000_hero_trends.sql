-- Hero pool cards from a player's recent games ("Add Monkey King to your carry heroes?").
--
-- The refresh-trends job (service role) reads each active Steam player's recent games from
-- our drafts, STRATZ and OpenDota, saves them in player_games, and opens a pool_suggestions
-- card when a hero and position qualifies (rules in functions/_shared/trends). Players only
-- read their own rows; they answer cards through an RPC added in a later migration.

-- One row per player and match, kept 60 days by the job.
create table public.player_games (
  user_id uuid not null references public.profiles (id) on delete cascade,
  match_id bigint not null check (match_id > 0),
  hero_id smallint not null check (hero_id > 0),
  -- 1 carry ... 5 hard support, and where it came from; both null when no source knew.
  position smallint check (position between 1 and 5),
  position_source text check (position_source in ('draft', 'stratz', 'opendota')),
  is_win boolean not null,
  -- Null when neither STRATZ nor the OpenDota benchmarks could judge the game.
  is_strong boolean,
  -- STRATZ IMP, 0 is an average game.
  imp smallint check (imp between -100 and 100),
  -- Percentile (0 to 1) per stat against the hero's OpenDota benchmarks, and the values behind them.
  percentiles jsonb check (percentiles is null or jsonb_typeof(percentiles) = 'object'),
  stat_values jsonb check (stat_values is null or jsonb_typeof(stat_values) = 'object'),
  -- The lobby's average rank tier, for the later "form" line.
  lobby_rank smallint check (lobby_rank between 10 and 80),
  started_at timestamptz not null,
  game_mode smallint not null,
  lobby_type smallint not null,
  created_at timestamptz not null default now(),
  primary key (user_id, match_id),
  check ((position is null) = (position_source is null))
);

create index player_games_started_at_idx on public.player_games (started_at);

-- One card per hero and position. "open" waits for an answer, "snoozed" comes back after
-- snooze_until, "declined" may come back after 30 days with 3 more strong wins, "blocked"
-- never comes back (a second No), "expired" stopped qualifying or went unanswered.
create table public.pool_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  hero_id smallint not null check (hero_id > 0),
  position smallint not null check (position between 1 and 5),
  status text not null default 'open'
    check (status in ('open', 'snoozed', 'accepted', 'declined', 'blocked', 'expired')),
  -- The card's words and the numbers they quote, fixed when the card opens.
  question text not null check (char_length(question) between 1 and 200),
  reason text not null check (char_length(reason) between 1 and 500),
  evidence jsonb not null check (jsonb_typeof(evidence) = 'object'),
  snooze_until timestamptz,
  decline_count smallint not null default 0 check (decline_count >= 0),
  declined_at timestamptz,
  answered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'snoozed') = (snooze_until is not null))
);

-- At most one live card per hero and position.
create unique index pool_suggestions_live_idx on public.pool_suggestions (user_id, hero_id, position)
  where status in ('open', 'snoozed');
create index pool_suggestions_user_idx on public.pool_suggestions (user_id, status);

create trigger pool_suggestions_touch_updated_at
before update on public.pool_suggestions
for each row execute function public.touch_updated_at();

-- OpenDota benchmarks per hero, refreshed weekly by the job so each hero costs one call a week.
create table public.hero_benchmarks (
  hero_id smallint primary key check (hero_id > 0),
  benchmarks jsonb not null check (jsonb_typeof(benchmarks) = 'object'),
  fetched_at timestamptz not null default now()
);

alter table public.profiles
  -- When the job last read the player's games, and what it found: 'ok', or 'hidden' when
  -- OpenDota returned no games although the player has a hero record.
  add column trends_checked_at timestamptz,
  add column trends_state text check (trends_state in ('ok', 'hidden')),
  -- Set at most every 10 minutes while the player uses the site; the job only reads active players.
  add column last_active_at timestamptz,
  -- The player's "Stop these suggestions" switch.
  add column pool_suggestions_off boolean not null default false;

alter table public.player_games enable row level security;
alter table public.pool_suggestions enable row level security;
alter table public.hero_benchmarks enable row level security;

revoke insert, update, delete on public.player_games, public.pool_suggestions from anon, authenticated;
revoke all on public.hero_benchmarks from anon, authenticated;

create policy "Read own games" on public.player_games
for select to authenticated using ((select auth.uid()) = user_id);

create policy "Read own pool cards" on public.pool_suggestions
for select to authenticated using ((select auth.uid()) = user_id);

-- OpenDota budget per caller: the global cap still holds, and a caller with its own cap (the
-- trends job) can never take more than that share, so reports and profile syncs keep calls.
create table public.opendota_caller_calls (
  day date not null,
  caller text not null check (char_length(caller) between 1 and 40),
  calls integer not null check (calls >= 0),
  primary key (day, caller)
);

alter table public.opendota_caller_calls enable row level security;
revoke all on public.opendota_caller_calls from anon, authenticated;

drop function public.take_opendota_calls(integer, integer);

-- Takes `wanted` calls from today's budget of `daily_cap`, and, when caller_cap is given,
-- from caller_name's own share too. Returns true when they fit, false (taking nothing) when
-- they don't. Locks the day's rows in a fixed order (global, then caller) so two callers at
-- once neither overspend nor deadlock. Service role only.
create function public.take_opendota_calls(
  wanted integer,
  daily_cap integer default 800,
  caller_name text default 'default',
  caller_cap integer default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'utc')::date;
  used integer;
  caller_used integer;
begin
  if wanted is null or wanted < 1 or wanted > daily_cap or (caller_cap is not null and wanted > caller_cap) then
    return false;
  end if;

  insert into public.opendota_calls (day, calls) values (today, 0) on conflict (day) do nothing;
  select c.calls into used from public.opendota_calls c where c.day = today for update;
  if used + wanted > daily_cap then
    return false;
  end if;

  insert into public.opendota_caller_calls (day, caller, calls) values (today, caller_name, 0)
  on conflict (day, caller) do nothing;
  select c.calls into caller_used from public.opendota_caller_calls c
  where c.day = today and c.caller = caller_name for update;
  if caller_cap is not null and caller_used + wanted > caller_cap then
    return false;
  end if;

  update public.opendota_calls c set calls = c.calls + wanted where c.day = today;
  update public.opendota_caller_calls c set calls = c.calls + wanted
  where c.day = today and c.caller = caller_name;
  return true;
end;
$$;

revoke execute on function public.take_opendota_calls from public, anon, authenticated;
grant execute on function public.take_opendota_calls to service_role;
