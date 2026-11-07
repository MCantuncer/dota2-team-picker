-- Fill My Heroes from a player's own games (plan "Auto-Fill My Heroes"). The fill-heroes edge
-- function reads the games and judges them; this migration keeps its state and saves its result.
--
-- A fill is claimed first (claim_hero_fill sets 'running'), then saved (save_hero_fill) or
-- failed (fail_hero_fill). A failed fill waits and is retried by the refresh-trends job:
-- 30 minutes, 2 hours, 8 hours, then 'failed' for good until the player presses Fill From My
-- Games. A fill stuck in 'running' for 10 minutes counts as a failed try.
--
-- Only the service role calls these functions: the edge function takes the player from their
-- token, never from the request body.

alter table public.profiles
  add column hero_fill_state text
    check (hero_fill_state in ('running', 'done', 'no_games', 'too_few', 'waiting', 'failed')),
  -- When the current or last fill was claimed.
  add column hero_fill_at timestamptz,
  -- Failed tries since the last fill that finished.
  add column hero_fill_tries smallint not null default 0 check (hero_fill_tries between 0 and 4),
  -- While 'waiting': when the job may try again.
  add column hero_fill_next_at timestamptz,
  -- Games with a known position behind the last finished fill, for the summary line.
  add column hero_fill_games integer check (hero_fill_games >= 0);

comment on column public.profiles.hero_fill_state is
  'Fill From My Games: null never ran; running, done, no_games, too_few, waiting (retry at hero_fill_next_at) or failed.';

create index profiles_hero_fill_due_idx on public.profiles (hero_fill_next_at)
where hero_fill_state = 'waiting';

-- The heroes a fill added, with the numbers their "From Your Games" reason quotes. A row goes
-- with its favorite_heroes row: removing the hero removes its reason.
create table public.hero_fill_picks (
  user_id uuid not null,
  position smallint not null check (position between 1 and 5),
  hero_id smallint not null check (hero_id > 0),
  kind text not null check (kind in ('regular', 'proven')),
  games integer not null check (games > 0),
  wins integer not null check (wins between 0 and games),
  strong_games integer not null check (strong_games >= 0),
  judged_games integer not null check (judged_games between strong_games and games),
  last_played timestamptz not null,
  -- Games a Regular hero needed at its record; null for Proven.
  games_needed integer check (games_needed > 0),
  filled_at timestamptz not null default now(),
  primary key (user_id, position, hero_id),
  foreign key (user_id, position, hero_id)
    references public.favorite_heroes (user_id, position, hero_id) on delete cascade
);

alter table public.hero_fill_picks enable row level security;
create policy "Read own fill picks" on public.hero_fill_picks
for select to authenticated using ((select auth.uid()) = user_id);
revoke insert, update, delete on public.hero_fill_picks from anon, authenticated;

-- Backoff after a failed try: 30 minutes, 2 hours, then 8 hours.
create function public.hero_fill_backoff(tries smallint)
returns interval
language sql
immutable
set search_path = ''
as $$
  select case when tries <= 1 then interval '30 minutes' when tries = 2 then interval '2 hours' else interval '8 hours' end
$$;

-- Marks the player's running fill as failed: 'waiting' with backoff, or 'failed' after 4 tries.
-- Returns the new state, or null when no fill was running.
create function public.fail_hero_fill(player uuid)
returns text
language sql
security definer
set search_path = ''
as $$
  update public.profiles p
  set hero_fill_tries = p.hero_fill_tries + 1,
    hero_fill_state = case when p.hero_fill_tries + 1 >= 4 then 'failed' else 'waiting' end,
    hero_fill_next_at = case when p.hero_fill_tries + 1 >= 4 then null
      else now() + public.hero_fill_backoff((p.hero_fill_tries + 1)::smallint) end
  where p.id = player and p.hero_fill_state = 'running'
  returning p.hero_fill_state
$$;

-- Claims a fill for the player, setting 'running'. `by` is who asks: 'welcome' (the first
-- My Heroes visit), 'button' (Fill From My Games) or 'job' (the retry job). True when claimed;
-- false means the saved result stands (or a retry isn't due yet).
create function public.claim_hero_fill(player uuid, by text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.profiles%rowtype;
  claim boolean;
begin
  if by is null or by not in ('welcome', 'button', 'job') then
    raise exception 'by must be welcome, button or job' using errcode = '22023';
  end if;
  -- The lock makes two quick claims run one after the other; only the first gets 'running'.
  select * into p from public.profiles where id = player for update;
  if not found then
    return false;
  end if;

  -- A run that never finished counts as a failed try.
  if p.hero_fill_state = 'running' and p.hero_fill_at < now() - interval '10 minutes' then
    perform public.fail_hero_fill(player);
    select * into p from public.profiles where id = player;
  end if;

  claim := case
    when p.hero_fill_state is null then true
    when p.hero_fill_state = 'waiting' then by in ('job', 'button') and p.hero_fill_next_at <= now()
    when p.hero_fill_state in ('no_games', 'too_few', 'failed') then
      by = 'button' and p.hero_fill_at < now() - interval '10 minutes'
    when p.hero_fill_state = 'done' then by = 'button' and p.hero_fill_at < now() - interval '1 day'
    else false
  end;
  if not claim then
    return false;
  end if;

  update public.profiles
  set hero_fill_state = 'running', hero_fill_at = now(), hero_fill_next_at = null,
    -- A player's own new start (not a retry) begins a fresh count of tries.
    hero_fill_tries = case when p.hero_fill_state = 'waiting' then p.hero_fill_tries else 0 end
  where id = player;
  return true;
end;
$$;

-- Saves the player's running fill in one transaction.
--   result: 'done', 'no_games' or 'too_few'.
--   fill_positions: the player's positions (1 to 5).
--   picks: [{position, hero_id, kind, games, wins, strong_games, judged_games, last_played (unix s), games_needed}].
-- Adds only: never removes a hero or position, skips what the player removed, and keeps heroes
-- they added themselves unmarked. Runs Support Copy like any other add. Returns the heroes added,
-- or null when no fill was running.
create function public.save_hero_fill(
  player uuid,
  result text,
  fill_positions smallint[],
  picks jsonb,
  positioned_games integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.profiles%rowtype;
  pick jsonb;
  pick_position smallint;
  pick_hero smallint;
  added integer := 0;
  added_rows integer;
begin
  if result is null or result not in ('done', 'no_games', 'too_few') then
    raise exception 'result must be done, no_games or too_few' using errcode = '22023';
  end if;
  if positioned_games is null or positioned_games < 0 then
    raise exception 'positioned_games must be 0 or more' using errcode = '22023';
  end if;
  select * into p from public.profiles where id = player for update;
  if not found or p.hero_fill_state is distinct from 'running' then
    return null;
  end if;

  if result = 'done' then
    insert into public.favorite_positions (user_id, position)
    select player, pos from unnest(coalesce(fill_positions, '{}')) pos
    where pos between 1 and 5 and not exists (
      select 1 from public.pool_removals r where r.user_id = player and r.position = pos and r.hero_id = 0
    )
    on conflict do nothing;

    -- Real heroes for both support lists: each keeps its own, so copying never starts.
    if p.support_copy is null and exists (select 1 from jsonb_array_elements(picks) e where (e ->> 'position') = '4')
      and exists (select 1 from jsonb_array_elements(picks) e where (e ->> 'position') = '5') then
      update public.profiles set support_copy = 'off' where id = player;
    end if;

    for pick in select e from jsonb_array_elements(coalesce(picks, '[]'::jsonb)) e loop
      pick_position := (pick ->> 'position')::smallint;
      pick_hero := (pick ->> 'hero_id')::smallint;
      if pick_position not between 1 and 5 or pick_hero is null or pick_hero <= 0 then
        raise exception 'Bad pick %', pick using errcode = '22023';
      end if;
      continue when exists (
        select 1 from public.pool_removals r
        where r.user_id = player and r.position = pick_position and r.hero_id in (0, pick_hero)
      );

      insert into public.favorite_heroes (user_id, position, hero_id) values (player, pick_position, pick_hero)
      on conflict do nothing;
      get diagnostics added_rows = row_count;
      if added_rows > 0 then
        added := added + 1;
        insert into public.hero_fill_picks
          (user_id, position, hero_id, kind, games, wins, strong_games, judged_games, last_played, games_needed)
        values (
          player, pick_position, pick_hero, pick ->> 'kind', (pick ->> 'games')::integer, (pick ->> 'wins')::integer,
          (pick ->> 'strong_games')::integer, (pick ->> 'judged_games')::integer,
          to_timestamp((pick ->> 'last_played')::double precision), (pick ->> 'games_needed')::integer
        );
        perform public.apply_support_copy(player, pick_position, pick_hero, true);
      else
        -- Already listed: a hero an earlier fill added gets fresh numbers; one the player added stays unmarked.
        update public.hero_fill_picks f
        set kind = pick ->> 'kind', games = (pick ->> 'games')::integer, wins = (pick ->> 'wins')::integer,
          strong_games = (pick ->> 'strong_games')::integer, judged_games = (pick ->> 'judged_games')::integer,
          last_played = to_timestamp((pick ->> 'last_played')::double precision),
          games_needed = (pick ->> 'games_needed')::integer, filled_at = now()
        where f.user_id = player and f.position = pick_position and f.hero_id = pick_hero;
      end if;
    end loop;
  end if;

  update public.profiles
  set hero_fill_state = result, hero_fill_tries = 0, hero_fill_next_at = null, hero_fill_games = positioned_games
  where id = player;
  return added;
end;
$$;

-- Fills the retry job may run now: waiting ones that are due, and runs stuck for 10 minutes.
create function public.due_hero_fills(max_fills integer)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id from public.profiles p
  where (p.hero_fill_state = 'waiting' and p.hero_fill_next_at <= now())
    or (p.hero_fill_state = 'running' and p.hero_fill_at < now() - interval '10 minutes')
  order by coalesce(p.hero_fill_next_at, p.hero_fill_at)
  limit greatest(max_fills, 0)
$$;

revoke execute on function public.hero_fill_backoff, public.fail_hero_fill, public.claim_hero_fill,
  public.save_hero_fill, public.due_hero_fills from public, anon, authenticated;
