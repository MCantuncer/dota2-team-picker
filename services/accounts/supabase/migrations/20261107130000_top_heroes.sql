-- Top 3: a player marks up to 3 heroes on each position list (Pos 1 to 5) as their best. Top 3 heroes get a
-- small extra push in pick suggestions. The slot number (1 to 3) keeps the order, and the unique index caps
-- each list at 3 even when two calls land at once. Only set_top_hero writes it.

alter table public.favorite_heroes
  add column top_slot smallint check (top_slot between 1 and 3);

comment on column public.favorite_heroes.top_slot is
  'Top 3 slot (1 to 3) on this position list, or null. Written only by set_top_hero.';

-- Nulls are distinct, so unstarred rows never clash.
create unique index favorite_heroes_top_slot_key on public.favorite_heroes (user_id, position, top_slot);

-- The position's Top 3 hero ids in slot order.
create function public.top_heroes(player uuid, hero_position smallint)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(f.hero_id order by f.top_slot), '[]'::jsonb)
  from public.favorite_heroes f
  where f.user_id = player and f.position = hero_position and f.top_slot is not null;
$$;

-- Adds (is_top) or removes one of the signed-in player's heroes from that position's Top 3. With 3 already
-- chosen, replace_hero names the one the new hero takes the place of, in one step. Returns
-- {position, top: [hero ids in slot order]}. Raises P0001 'top_full' when the Top 3 is full and no replace_hero is given.
create function public.set_top_hero(
  hero_position smallint,
  hero smallint,
  is_top boolean,
  replace_hero smallint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  slot smallint;
begin
  if me is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  -- Pos 0 (any position) has no screen to star heroes on.
  if hero_position is null or hero_position not between 1 and 5 or hero is null or hero <= 0 or is_top is null
    or replace_hero <= 0 then
    raise exception 'Bad hero or position' using errcode = '22023';
  end if;
  if replace_hero is not null and (not is_top or replace_hero = hero) then
    raise exception 'Replace only when adding another hero' using errcode = '22023';
  end if;

  if not is_top then
    update public.favorite_heroes f set top_slot = null
    where f.user_id = me and f.position = hero_position and f.hero_id = hero;
    return jsonb_build_object('position', hero_position, 'top', public.top_heroes(me, hero_position));
  end if;

  -- Already in the Top 3: nothing to do, so a second tap never asks which hero to replace.
  if exists (
    select 1 from public.favorite_heroes f
    where f.user_id = me and f.position = hero_position and f.hero_id = hero and f.top_slot is not null
  ) then
    return jsonb_build_object('position', hero_position, 'top', public.top_heroes(me, hero_position));
  end if;

  if replace_hero is not null then
    select f.top_slot into slot from public.favorite_heroes f
    where f.user_id = me and f.position = hero_position and f.hero_id = replace_hero and f.top_slot is not null
    for update;
    if slot is null then
      raise exception 'That hero is not in your Top 3' using errcode = '22023';
    end if;
    update public.favorite_heroes f set top_slot = null
    where f.user_id = me and f.position = hero_position and f.hero_id = replace_hero;
  else
    select s into slot from generate_series(1, 3) s
    where not exists (
      select 1 from public.favorite_heroes f where f.user_id = me and f.position = hero_position and f.top_slot = s
    )
    order by s limit 1;
    if slot is null then
      raise exception 'top_full' using errcode = 'P0001', hint = 'Pick the hero to replace.';
    end if;
  end if;

  -- One update both checks the hero is listed and stars it. A starred row is the player's own, so Support Copy
  -- never removes it with the source list.
  update public.favorite_heroes f set top_slot = slot, copied_from = null
  where f.user_id = me and f.position = hero_position and f.hero_id = hero;
  if not found then
    raise exception 'That hero is not in your list' using errcode = '22023';
  end if;
  return jsonb_build_object('position', hero_position, 'top', public.top_heroes(me, hero_position));
end;
$$;

revoke execute on function public.top_heroes from public, anon, authenticated;
revoke execute on function public.set_top_hero from public, anon;
grant execute on function public.set_top_hero to authenticated;
