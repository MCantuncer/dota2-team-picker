-- Game check-ins: every draft a player fills with all 10 heroes is saved, so that after the game
-- we can learn its result and ask the player how the picks and the Game Story felt.
--
-- One row per player per board. A solo board (not in a party) is keyed by an id the Draft page
-- keeps with the board; a party board by its party draft. For a party board the hero lists and
-- the suggestions shown are read here from the shared draft, never taken from the page.
--
-- This migration adds the table and the save function. Finding the result and the check-in
-- questions come in later migrations, so their columns are here but nothing writes them yet.
-- Players read only their own rows; every write goes through a function.

create table public.game_check_ins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- The solo board's id, from the Draft page. Null for a party board.
  client_key uuid,
  -- The party draft, for a party board. Kept as null when the draft is deleted, so the answer stays.
  party_draft_id uuid references public.party_drafts (id) on delete set null,
  -- Our five heroes and the position of each (0 when nobody set one), their five, and the bans.
  allies smallint[] not null,
  ally_positions smallint[] not null,
  enemies smallint[] not null,
  bans smallint[] not null default '{}',
  -- The position this player planned for, and their hero when they picked one of ours.
  my_position smallint not null check (my_position between 1 and 5),
  my_hero smallint,
  -- The heroes suggested to this player, best first.
  shown smallint[] not null default '{}',
  -- Whether the Game Story was on screen for this board.
  story_shown boolean not null default false,
  -- When the board first had all 10 heroes.
  filled_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- The game on OpenDota (solo boards; a party board reads its party draft's match).
  match_id bigint check (match_id > 0),
  won boolean,
  -- The player's own word: did they play this game, and did they win.
  played boolean,
  player_won boolean,
  -- Set when OpenDota shows no recent games for the player twice, so we stop looking.
  profile_hidden boolean not null default false,
  find_tries smallint not null default 0 check (find_tries >= 0),
  result_checked_at timestamptz,

  -- The check-in answers.
  answered_at timestamptz,
  skipped_at timestamptz,
  snoozes smallint not null default 0 check (snoozes between 0 and 2),
  picks_feel text check (picks_feel in ('good', 'okay', 'bad')),
  story_feel text check (story_feel in ('helped', 'partly', 'off')),
  tags text[] not null default '{}' check (
    cardinality(tags) <= 3
    and tags <@ array['our_draft', 'their_draft', 'laning', 'mid_game', 'late_game', 'items', 'teammates', 'story_timings']
  ),
  note text check (char_length(note) between 1 and 280),

  -- A solo board or a party board, never both. A party row whose draft was deleted has neither.
  check (client_key is null or party_draft_id is null),
  -- array_position(..., null) finds a null element, which "0 < all" would let through.
  check (cardinality(allies) = 5 and 0 < all (allies) and array_position(allies, null) is null),
  check (
    cardinality(ally_positions) = 5 and 0 <= all (ally_positions) and 5 >= all (ally_positions)
    and array_position(ally_positions, null) is null
  ),
  check (cardinality(enemies) = 5 and 0 < all (enemies) and array_position(enemies, null) is null),
  check (cardinality(bans) <= 24 and 0 < all (bans) and array_position(bans, null) is null),
  check (cardinality(shown) <= 8 and 0 < all (shown) and array_position(shown, null) is null),
  check (my_hero is null or my_hero = any (allies)),
  check ((match_id is null) = (won is null)),
  check (answered_at is null or skipped_at is null)
);

comment on table public.game_check_ins is 'Every full 10-hero draft a player entered, its result and how the player said it felt.';

-- A solo board and a party board each save once per player.
create unique index game_check_ins_client_key_idx on public.game_check_ins (user_id, client_key) where client_key is not null;
create unique index game_check_ins_party_draft_idx on public.game_check_ins (user_id, party_draft_id) where party_draft_id is not null;
create index game_check_ins_user_filled_idx on public.game_check_ins (user_id, filled_at desc);
create index game_check_ins_party_draft_id_idx on public.game_check_ins (party_draft_id);

create trigger game_check_ins_touch_updated_at
before update on public.game_check_ins
for each row execute function public.touch_updated_at();

alter table public.game_check_ins enable row level security;
revoke insert, update, delete on public.game_check_ins from anon, authenticated;

create policy "Read own game check-ins" on public.game_check_ins
for select to authenticated using ((select auth.uid()) = user_id);

-- True when the list has no hero twice.
create function public.distinct_heroes(heroes smallint[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select count(distinct h) = count(h) from unnest(heroes) h
$$;

-- Saves the signed-in player's full board, or updates it while they edit. Returns the row id.
--
-- Solo board: pass key and every list. Party board: pass party_draft; the heroes, positions, bans
-- and the suggestions shown come from the shared draft and the list arguments are ignored. A
-- member who can no longer read the draft (it ended without them) can still update their own
-- row's position, hero and Story flag; its hero lists stay as saved.
create function public.save_game_check_in(
  key uuid,
  party_draft uuid,
  allies smallint[],
  ally_positions smallint[],
  enemies smallint[],
  bans smallint[],
  my_position smallint,
  my_hero smallint,
  shown smallint[],
  story_shown boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  existing public.game_check_ins;
  saved uuid;
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if (key is null) = (party_draft is null) then
    raise exception 'Pass a board key or a party draft, not both' using errcode = '22023';
  end if;
  if my_position is null or my_position not between 1 and 5 then
    raise exception 'Pick a position from 1 to 5' using errcode = '22023';
  end if;

  if key is not null then
    select * into existing from public.game_check_ins c where c.user_id = me and c.client_key = key for update;
  else
    select * into existing from public.game_check_ins c where c.user_id = me and c.party_draft_id = party_draft for update;
  end if;
  if existing.answered_at is not null or existing.skipped_at is not null then
    raise exception 'This game was already checked in' using errcode = '55000';
  end if;

  if party_draft is not null then
    if public.can_read_draft(party_draft) then
      -- The shared draft decides the lists.
      select
        coalesce(array_agg(s.hero_id order by s.hero_id) filter (where s.kind = 'ally'), '{}'),
        coalesce(array_agg(coalesce(s.position, 0) order by s.hero_id) filter (where s.kind = 'ally'), '{}'),
        coalesce(array_agg(s.hero_id order by s.hero_id) filter (where s.kind = 'enemy'), '{}'),
        coalesce(array_agg(s.hero_id order by s.hero_id) filter (where s.kind = 'ban'), '{}')
      into allies, ally_positions, enemies, bans
      from public.draft_state(party_draft) s;
      shown := coalesce(
        (select ds.heroes from public.draft_suggestions ds where ds.draft_id = party_draft and ds.user_id = me),
        '{}'
      );
    elsif existing.id is not null then
      allies := existing.allies;
      ally_positions := existing.ally_positions;
      enemies := existing.enemies;
      bans := existing.bans;
      shown := existing.shown;
    else
      raise exception 'Draft not found' using errcode = 'P0002';
    end if;
  end if;

  bans := coalesce(bans, '{}');
  ally_positions := coalesce(ally_positions, array_fill(0::smallint, array[5]));
  shown := coalesce(shown, '{}');
  if cardinality(allies) is distinct from 5 or cardinality(enemies) is distinct from 5 then
    raise exception 'Enter all 10 heroes first' using errcode = '22023';
  end if;
  if not (public.distinct_heroes(allies || enemies || bans) and public.distinct_heroes(shown)) then
    raise exception 'A hero can be in the draft only once' using errcode = '22023';
  end if;
  if my_hero is not null and not (my_hero = any (allies)) then
    raise exception 'Your hero must be on your team' using errcode = '22023';
  end if;

  if existing.id is null then
    if (select count(*) from public.game_check_ins c where c.user_id = me and c.filled_at > now() - interval '1 day') >= 30 then
      raise exception 'You saved 30 drafts today. Try again tomorrow.' using errcode = '54000';
    end if;
    insert into public.game_check_ins (
      user_id, client_key, party_draft_id, allies, ally_positions, enemies, bans,
      my_position, my_hero, shown, story_shown
    )
    values (me, key, party_draft, allies, ally_positions, enemies, bans, my_position, my_hero, shown, coalesce(story_shown, false))
    returning id into saved;
  else
    update public.game_check_ins c set
      allies = save_game_check_in.allies,
      ally_positions = save_game_check_in.ally_positions,
      enemies = save_game_check_in.enemies,
      bans = save_game_check_in.bans,
      my_position = save_game_check_in.my_position,
      my_hero = save_game_check_in.my_hero,
      shown = save_game_check_in.shown,
      -- Once shown, the Story counts as shown.
      story_shown = c.story_shown or coalesce(save_game_check_in.story_shown, false)
    where c.id = existing.id
    returning c.id into saved;
  end if;
  return saved;
end;
$$;

revoke execute on function public.save_game_check_in from public, anon;
grant execute on function public.save_game_check_in to authenticated;
revoke execute on function public.distinct_heroes from public, anon;
