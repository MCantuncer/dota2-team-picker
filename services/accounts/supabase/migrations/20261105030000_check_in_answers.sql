-- The check-in itself: which started game to ask about now, and the player's answers.
--
-- A game's result is its own match (solo boards, found by the build-reports job) or, for a party
-- board, its party draft's match, but only for players saved as playing that draft. A result the
-- player gives is kept apart in player_won; OpenDota's stays the result when it arrives.

alter table public.game_check_ins add column snoozed_until timestamptz;

-- The result of the signed-in player's check-in: the match and whether they won, or nulls.
create function public.check_in_result(c public.game_check_ins)
returns table (match_id bigint, won boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select c.match_id, c.won where c.match_id is not null
  union all
  select d.match_id, d.won
  from public.party_drafts d
  where c.match_id is null and d.id = c.party_draft_id and d.match_id is not null
    and exists (select 1 from public.draft_players p where p.draft_id = d.id and p.user_id = c.user_id)
  limit 1
$$;

revoke execute on function public.check_in_result from public, anon, authenticated;

-- The one started game to ask the signed-in player about now, newest first, on the Draft page
-- ('draft') or anywhere else on the site ('site'). Never a game answered, skipped, not played,
-- snoozed, or started over 3 days ago.
-- - Either surface: as soon as its result is known.
-- - Draft page: 20 minutes after the start (the player came back to the board).
-- - Site: 60 minutes after the start for players we can't look up (no Steam, or a hidden profile),
--   and for Steam players once every search is used up, at most until they snooze it twice.
create function public.due_check_in(surface text)
returns table (
  id uuid,
  party_draft_id uuid,
  allies smallint[],
  enemies smallint[],
  my_position smallint,
  my_hero smallint,
  story_shown boolean,
  started_at timestamptz,
  match_id bigint,
  won boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if surface is null or surface not in ('draft', 'site') then
    raise exception 'surface must be draft or site' using errcode = '22023';
  end if;
  return query
  select c.id, c.party_draft_id, c.allies, c.enemies, c.my_position, c.my_hero, c.story_shown, c.started_at,
    r.match_id, r.won
  from public.game_check_ins c
  join public.profiles pr on pr.id = c.user_id
  left join lateral public.check_in_result(c) r on true
  where c.user_id = me
    and c.started_at is not null and c.started_at > now() - interval '3 days'
    and c.answered_at is null and c.skipped_at is null and c.played is distinct from false
    and (c.snoozed_until is null or c.snoozed_until <= now())
    and (
      r.match_id is not null
      or (surface = 'draft' and c.started_at <= now() - interval '20 minutes')
      or (surface = 'site' and c.snoozes < 2 and c.started_at <= now() - interval '60 minutes'
        and (pr.steam_id is null or c.profile_hidden or c.find_tries >= 4))
    )
  order by c.started_at desc
  limit 1;
end;
$$;

revoke execute on function public.due_check_in from public, anon;
grant execute on function public.due_check_in to authenticated;

-- Saves the signed-in player's answers. Every answer is optional except that a game we have no
-- result for takes the player's Won or Lost, unless they say they didn't play it. A known result
-- is never overwritten by the player's.
create function public.answer_check_in(
  check_in uuid,
  played boolean default true,
  did_win boolean default null,
  picks text default null,
  story text default null,
  decided text[] default '{}',
  note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.game_check_ins;
  known boolean;
  clean_note text := nullif(btrim(note), '');
begin
  select * into c from public.game_check_ins g
  where g.id = check_in and g.user_id = (select auth.uid())
  for update;
  if c.id is null then
    raise exception 'Game not found' using errcode = 'P0002';
  end if;
  if c.answered_at is not null or c.skipped_at is not null then
    raise exception 'This game was already checked in' using errcode = '55000';
  end if;

  if played is false then
    update public.game_check_ins g set played = false, answered_at = now() where g.id = c.id;
    return;
  end if;

  known := exists (select 1 from public.check_in_result(c));
  if not known and did_win is null then
    raise exception 'Tell us if you won or lost' using errcode = '22023';
  end if;
  if not c.story_shown and story is not null then
    raise exception 'There was no Game Story for this game' using errcode = '22023';
  end if;
  if char_length(clean_note) > 280 then
    raise exception 'Keep the note to 280 characters' using errcode = '22023';
  end if;

  update public.game_check_ins g set
    played = true,
    player_won = case when known then null else did_win end,
    picks_feel = picks,
    story_feel = story,
    tags = coalesce((select array_agg(distinct t) from unnest(decided) t), '{}'),
    note = clean_note,
    answered_at = now()
  where g.id = c.id;
end;
$$;

-- Not Now: hides the check-in for two hours. After the second time it stays off the site and is
-- asked only on the Draft page.
create function public.snooze_check_in(check_in uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.game_check_ins g
  set snoozes = least(g.snoozes + 1, 2), snoozed_until = now() + interval '2 hours'
  where g.id = check_in and g.user_id = (select auth.uid()) and g.answered_at is null and g.skipped_at is null;
  if not found then
    raise exception 'Game not found' using errcode = 'P0002';
  end if;
end;
$$;

-- Skip: never ask about this game again.
create function public.skip_check_in(check_in uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.game_check_ins g set skipped_at = now()
  where g.id = check_in and g.user_id = (select auth.uid()) and g.answered_at is null and g.skipped_at is null;
  if not found then
    raise exception 'Game not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.answer_check_in, public.snooze_check_in, public.skip_check_in from public, anon;
grant execute on function public.answer_check_in, public.snooze_check_in, public.skip_check_in to authenticated;
