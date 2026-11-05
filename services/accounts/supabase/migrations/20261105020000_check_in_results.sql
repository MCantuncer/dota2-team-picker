-- Finding the result of a game check-in, so players are asked only when we can't tell.
--
-- - Party boards: claim_unattached_drafts now also takes OPEN party drafts with all 10 heroes,
--   20 minutes after their last entry, so a draft nobody ended still gets its match (and its
--   report). Open drafts have no draft_players yet, so their Steam accounts come from the party's
--   members, as attach_draft_match does. Party check-ins read their draft's result.
-- - Solo boards: claim_solo_check_ins hands the build-reports job the boards of Steam players
--   whose game we haven't found, and the job saves what it finds with set_check_in_result.
-- - One helper holds the retry gaps for both: base, then twice base, four times base, ...

alter table public.game_check_ins
  add column started_at timestamptz,
  add column empty_finds smallint not null default 0 check (empty_finds >= 0);

comment on column public.game_check_ins.started_at is 'When the player pressed Start Game: only started boards are looked up and asked about.';

comment on column public.game_check_ins.empty_finds is 'How many searches found no recent games at all; two in a row marks the profile hidden.';

-- True when a search that ran tries times, last at checked, is due again: never before, or at
-- least base * 2^(tries - 1) ago, and fewer than max_tries so far.
create function public.find_is_due(checked timestamptz, tries integer, base interval, max_tries integer)
returns boolean
language sql
stable
set search_path = ''
as $$
  select tries < max_tries
    and (checked is null or checked <= now() - base * power(2, greatest(tries - 1, 0)))
$$;

revoke execute on function public.find_is_due from public, anon, authenticated;

-- Ended drafts of the last 6 hours, and open drafts with all 10 heroes whose last entry was 20
-- minutes to 6 hours ago, with no match yet: tried at most 6 times at growing gaps (10, 20, 40
-- minutes ...). Each comes with our heroes and the players' accounts to search; drafts with
-- neither are left alone.
create or replace function public.claim_unattached_drafts(max_rows integer default 5)
returns table (draft_id uuid, created_at timestamptz, allies smallint[], account_ids bigint[])
language plpgsql
security definer
set search_path = ''
as $$
begin
  if max_rows not between 1 and 20 then
    raise exception 'max_rows must be 1 to 20' using errcode = '22023';
  end if;
  return query
  with candidates as (
    select d.id, d.ended_at, (select max(a.created_at) from public.draft_actions a where a.draft_id = d.id) as last_action
    from public.party_drafts d
    where d.match_id is null and (d.ended_at is null or d.ended_at > now() - interval '6 hours')
  ), states as (
    select s.draft_id, s.hero_id, s.kind from (
      select distinct on (a.draft_id, a.hero_id) a.draft_id, a.hero_id, a.kind
      from public.draft_actions a
      join candidates c on c.id = a.draft_id
      order by a.draft_id, a.hero_id, a.id desc
    ) s
  ), picks as (
    select s.draft_id,
      array_agg(s.hero_id order by s.hero_id) filter (where s.kind = 'ally') as allies,
      count(*) filter (where s.kind = 'ally') as ally_count,
      count(*) filter (where s.kind = 'enemy') as enemy_count
    from states s
    group by s.draft_id
  ), ready as (
    select c.id from candidates c
    join picks on picks.draft_id = c.id
    where picks.allies is not null
      and (
        c.ended_at is not null
        or (picks.ally_count = 5 and picks.enemy_count = 5
          and c.last_action <= now() - interval '20 minutes' and c.last_action > now() - interval '6 hours')
      )
  ), accounts as (
    select p.draft_id, array_agg(p.account_id order by p.account_id) as account_ids
    from public.draft_players p
    join ready r on r.id = p.draft_id
    where p.account_id is not null
    group by p.draft_id
    union all
    -- An open draft has no players saved yet: its party's members with Steam linked.
    select d.id, array_agg(pr.steam_id::bigint - 76561197960265728 order by pr.steam_id)
    from public.party_drafts d
    join ready r on r.id = d.id
    join public.party_members m on m.party_id = d.party_id
    join public.profiles pr on pr.id = m.user_id
    where d.ended_at is null and pr.steam_id is not null
      and not exists (select 1 from public.draft_players x where x.draft_id = d.id)
    group by d.id
  ), due as (
    select d.id from public.party_drafts d
    join ready on ready.id = d.id
    join accounts on accounts.draft_id = d.id
    where d.match_id is null and public.find_is_due(d.result_checked_at, d.find_tries, interval '10 minutes', 6)
    order by coalesce(d.ended_at, d.created_at)
    limit max_rows
    for update of d skip locked
  ), claimed as (
    update public.party_drafts d set find_tries = d.find_tries + 1, result_checked_at = now()
    from due where d.id = due.id
    returning d.id, d.created_at
  )
  select c.id, c.created_at, picks.allies, accounts.account_ids
  from claimed c
  join picks on picks.draft_id = c.id
  join accounts on accounts.draft_id = c.id;
end;
$$;

-- Marks the signed-in player's board as a game they are playing (Start Game), or not (Not
-- Playing It). Starting again keeps the first start time. Returns the start time, null when cleared.
create function public.set_game_started(check_in uuid, started boolean)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  started_on timestamptz;
begin
  if started is null then
    raise exception 'Say whether the game started' using errcode = '22023';
  end if;
  update public.game_check_ins c
  set started_at = case when started then coalesce(c.started_at, now()) end,
    -- A board started again after Not Playing It is looked up from scratch.
    find_tries = case when started and c.started_at is not null then c.find_tries else 0 end
  where c.id = check_in and c.user_id = (select auth.uid()) and c.answered_at is null and c.skipped_at is null
  returning c.started_at into started_on;
  if not found then
    raise exception 'Game not found' using errcode = 'P0002';
  end if;
  return started_on;
end;
$$;

revoke execute on function public.set_game_started from public, anon;
grant execute on function public.set_game_started to authenticated;

-- Started solo boards of Steam players with no result yet, 20 minutes to 6 hours after the start:
-- tried at most 4 times at growing gaps (20, 40, 80 minutes), and only each player's 3 newest
-- started boards of the day, so practice drafts can't spend the OpenDota budget. Boards the player said
-- they didn't play, skipped, or whose profile looks hidden are left alone.
create function public.claim_solo_check_ins(max_rows integer default 2)
returns table (id uuid, account_id bigint, allies smallint[], my_hero smallint, started_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if max_rows not between 1 and 10 then
    raise exception 'max_rows must be 1 to 10' using errcode = '22023';
  end if;
  return query
  with newest as (
    select c.id, row_number() over (partition by c.user_id order by c.started_at desc) as n
    from public.game_check_ins c
    where c.client_key is not null and c.started_at > now() - interval '1 day'
  ), due as (
    select c.id from public.game_check_ins c
    join newest on newest.id = c.id and newest.n <= 3
    join public.profiles pr on pr.id = c.user_id and pr.steam_id is not null
    where c.match_id is null and c.played is distinct from false and c.skipped_at is null
      and not c.profile_hidden
      and c.started_at <= now() - interval '20 minutes' and c.started_at > now() - interval '6 hours'
      and public.find_is_due(c.result_checked_at, c.find_tries, interval '20 minutes', 4)
    order by c.started_at
    limit max_rows
    for update of c skip locked
  ), claimed as (
    update public.game_check_ins c set find_tries = c.find_tries + 1, result_checked_at = now()
    from due where c.id = due.id
    returning c.id, c.user_id, c.allies, c.my_hero, c.started_at
  )
  select c.id, pr.steam_id::bigint - 76561197960265728, c.allies, c.my_hero, c.started_at
  from claimed c
  join public.profiles pr on pr.id = c.user_id;
end;
$$;

-- Saves the game the job found for a solo board. False when it already had one.
create function public.set_check_in_result(check_in uuid, match bigint, did_win boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if match is null or match <= 0 or did_win is null then
    raise exception 'A result needs a match and who won' using errcode = '22023';
  end if;
  update public.game_check_ins c
  set match_id = match, won = did_win, profile_hidden = false, empty_finds = 0
  where c.id = check_in and c.match_id is null;
  return found;
end;
$$;

-- Notes a search that found no recent games at all. The second one in a row marks the profile
-- hidden: the player is then asked like a player without Steam.
create function public.note_check_in_no_games(check_in uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.game_check_ins c
  set empty_finds = c.empty_finds + 1, profile_hidden = c.empty_finds + 1 >= 2
  where c.id = check_in and c.match_id is null
$$;

-- Deletes check-ins older than 180 days. Returns how many.
create function public.forget_old_check_ins()
returns integer
language sql
security definer
set search_path = ''
as $$
  with gone as (
    delete from public.game_check_ins c where c.filled_at < now() - interval '180 days' returning 1
  )
  select count(*)::integer from gone
$$;

revoke execute on function public.claim_solo_check_ins, public.set_check_in_result,
  public.note_check_in_no_games, public.forget_old_check_ins from public, anon, authenticated;
grant execute on function public.claim_solo_check_ins, public.set_check_in_result,
  public.note_check_in_no_games, public.forget_old_check_ins to service_role;
