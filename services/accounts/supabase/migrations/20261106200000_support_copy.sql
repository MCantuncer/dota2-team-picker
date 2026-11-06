-- Support Copy: Pos 4 and Pos 5 heroes are mostly the same, so the first support list a player
-- fills is copied to the other one until they change the other list themselves.
--
-- It starts when a player adds a hero to Pos 4 or Pos 5 while both support lists are empty and
-- copying never ran (profiles.support_copy is null). The list they add to becomes the source:
-- every add or remove there is done on the other list too. The first change on the other list,
-- or Stop Copying, turns it off for good.
--
-- Also adds pool_removals: the heroes and positions a player removed themselves, so nothing that
-- fills My Heroes for them (copying here, the fill from real games later, the trend cards) adds
-- them back. Adding a hero or position by hand again clears it.

alter table public.profiles
  add column support_copy text check (support_copy in ('on', 'off')),
  add column support_copy_from smallint check (support_copy_from in (4, 5)),
  add constraint profiles_support_copy_source_check check ((support_copy = 'on') = (support_copy_from is not null));

comment on column public.profiles.support_copy is
  'Support Copy: null never started, on while the source list is copied, off for good.';

-- The source position of a copied row (4 or 5), so its "Copied From" mark outlives copying.
alter table public.favorite_heroes
  add column copied_from smallint check (copied_from in (4, 5));

-- Players add their own rows, but only the copy functions mark a row as copied.
revoke insert on public.favorite_heroes from anon, authenticated;
grant insert (user_id, position, hero_id) on public.favorite_heroes to authenticated;

create table public.pool_removals (
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- 0 is the "any position" list, as in favorite_heroes.
  position smallint not null check (position between 0 and 5),
  -- 0 means the whole position was removed.
  hero_id smallint not null check (hero_id >= 0),
  created_at timestamptz not null default now(),
  primary key (user_id, position, hero_id)
);

comment on table public.pool_removals is
  'Heroes (hero_id > 0) and positions (hero_id 0) a player removed themselves; nothing adds them back.';

alter table public.pool_removals enable row level security;
create policy "Read own removals" on public.pool_removals
for select to authenticated using ((select auth.uid()) = user_id);
revoke insert, update, delete on public.pool_removals from anon, authenticated;

-- Remembers a removal the player made. Rows removed by copying (app.support_copy = 'on' in this
-- transaction) are not theirs, and a cascade from a deleted account has no profile to remember for.
create function public.remember_pool_removal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.support_copy', true), '') = 'on'
    or not exists (select 1 from public.profiles p where p.id = old.user_id) then
    return null;
  end if;
  insert into public.pool_removals (user_id, position, hero_id)
  -- favorite_positions rows have no hero, so they are remembered as hero 0.
  values (old.user_id, old.position, coalesce((to_jsonb(old) ->> 'hero_id')::smallint, 0))
  on conflict do nothing;
  return null;
end;
$$;

-- Adding a hero or position again clears its removal.
create function public.forget_pool_removal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.support_copy', true), '') = 'on' then
    return null;
  end if;
  delete from public.pool_removals r
  where r.user_id = new.user_id and r.position = new.position
    and r.hero_id = coalesce((to_jsonb(new) ->> 'hero_id')::smallint, 0);
  return null;
end;
$$;

create trigger favorite_heroes_remember_removal after delete on public.favorite_heroes
for each row execute function public.remember_pool_removal();
create trigger favorite_heroes_forget_removal after insert on public.favorite_heroes
for each row execute function public.forget_pool_removal();
create trigger favorite_positions_remember_removal after delete on public.favorite_positions
for each row execute function public.remember_pool_removal();
create trigger favorite_positions_forget_removal after insert on public.favorite_positions
for each row execute function public.forget_pool_removal();

revoke execute on function public.remember_pool_removal, public.forget_pool_removal from public, anon, authenticated;

-- Runs Support Copy after a hero was added to (is_on) or removed from a position. Called by
-- the functions that change a player's heroes, never by players: it takes any user id.
create function public.apply_support_copy(player uuid, changed_position smallint, hero smallint, is_on boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  state text;
  source smallint;
  other smallint := 9 - changed_position;
begin
  if changed_position not in (4, 5) then
    return;
  end if;
  -- The lock makes two quick adds on Pos 4 and Pos 5 run one after the other.
  select p.support_copy, p.support_copy_from into state, source
  from public.profiles p where p.id = player for update;
  if not found or state = 'off' then
    return;
  end if;

  if state is null then
    -- The first time: only when this hero is the first on either support list.
    if not is_on or exists (
      select 1 from public.favorite_heroes f
      where f.user_id = player and f.position in (4, 5)
        and not (f.position = changed_position and f.hero_id = hero)
    ) then
      update public.profiles set support_copy = 'off' where id = player;
      return;
    end if;
    update public.profiles set support_copy = 'on', support_copy_from = changed_position where id = player;
    source := changed_position;
  elsif changed_position <> source then
    -- The player changed the other list: from now on the two lists are their own.
    update public.profiles set support_copy = 'off', support_copy_from = null where id = player;
    return;
  end if;

  perform set_config('app.support_copy', 'on', true);
  if is_on then
    insert into public.favorite_heroes (user_id, position, hero_id, copied_from)
    select player, other, hero, source
    where not exists (
      select 1 from public.pool_removals r
      where r.user_id = player and r.position = other and r.hero_id in (0, hero)
    )
    on conflict do nothing;
  else
    delete from public.favorite_heroes f
    where f.user_id = player and f.position = other and f.hero_id = hero and f.copied_from is not null;
  end if;
  perform set_config('app.support_copy', '', true);
end;
$$;

revoke execute on function public.apply_support_copy from public, anon, authenticated;

-- The two support lists and the copy state, as My Heroes shows them after a change.
create function public.support_lists(player uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'support_copy', p.support_copy,
    'support_copy_from', p.support_copy_from,
    'heroes', jsonb_build_object(
      '4', coalesce((select jsonb_agg(f.hero_id order by f.created_at, f.hero_id) from public.favorite_heroes f
                     where f.user_id = p.id and f.position = 4), '[]'::jsonb),
      '5', coalesce((select jsonb_agg(f.hero_id order by f.created_at, f.hero_id) from public.favorite_heroes f
                     where f.user_id = p.id and f.position = 5), '[]'::jsonb)
    )
  )
  from public.profiles p where p.id = player
$$;

revoke execute on function public.support_lists from public, anon, authenticated;

-- Adds (is_on) or removes one of the signed-in player's heroes and runs Support Copy.
-- Returns the two support lists and the copy state.
create function public.set_favorite_hero(hero_position smallint, hero smallint, is_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if hero_position is null or hero_position not between 0 and 5 or hero is null or hero <= 0 or is_on is null then
    raise exception 'Bad hero or position' using errcode = '22023';
  end if;
  -- The player's own change goes first, so its removal is remembered as theirs.
  if is_on then
    insert into public.favorite_heroes (user_id, position, hero_id) values (me, hero_position, hero)
    on conflict (user_id, position, hero_id) do update set copied_from = null;
  else
    delete from public.favorite_heroes f where f.user_id = me and f.position = hero_position and f.hero_id = hero;
  end if;
  perform public.apply_support_copy(me, hero_position, hero, is_on);
  return public.support_lists(me);
end;
$$;

-- Stop Copying: both support lists stay as they are and become the player's own.
create function public.stop_support_copy()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  update public.profiles set support_copy = 'off', support_copy_from = null where id = me and support_copy = 'on';
  return public.support_lists(me);
end;
$$;

revoke execute on function public.set_favorite_hero, public.stop_support_copy from public, anon;
grant execute on function public.set_favorite_hero, public.stop_support_copy to authenticated;

-- A Yes on a hero pool card is copied like a hero added by hand. Same as before otherwise.
create or replace function public.answer_pool_suggestion(card uuid, answer text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  suggestion public.pool_suggestions%rowtype;
  earlier_noes integer;
  added_rows integer;
begin
  if answer is null or answer not in ('yes', 'no', 'later') then
    raise exception 'Answer must be yes, no or later' using errcode = '22023';
  end if;
  select * into suggestion from public.pool_suggestions s where s.id = card and s.user_id = me for update;
  if not found then
    raise exception 'Card not found' using errcode = 'P0002';
  end if;
  if suggestion.status not in ('open', 'snoozed') then
    return suggestion.status;
  end if;

  if answer = 'yes' then
    insert into public.favorite_positions (user_id, position) values (me, suggestion.position) on conflict do nothing;
    insert into public.favorite_heroes (user_id, position, hero_id) values (me, suggestion.position, suggestion.hero_id)
    on conflict do nothing;
    get diagnostics added_rows = row_count;
    if added_rows > 0 then
      perform public.apply_support_copy(me, suggestion.position, suggestion.hero_id, true);
    end if;
    update public.pool_suggestions
    set status = 'accepted', snooze_until = null, answered_at = now()
    where id = card;
    return 'accepted';
  elsif answer = 'no' then
    select count(*) into earlier_noes from public.pool_suggestions s
    where s.user_id = me and s.hero_id = suggestion.hero_id and s.position = suggestion.position and s.status = 'declined';
    update public.pool_suggestions
    set status = case when earlier_noes >= 1 then 'blocked' else 'declined' end,
      decline_count = earlier_noes + 1, declined_at = now(), snooze_until = null, answered_at = now()
    where id = card;
    return case when earlier_noes >= 1 then 'blocked' else 'declined' end;
  else
    update public.pool_suggestions
    set status = 'snoozed', snooze_until = now() + interval '3 days'
    where id = card;
    return 'snoozed';
  end if;
end;
$$;
