-- Top 5: players now star up to 5 heroes on each position list instead of 3. The slot check widens to 1 to 5
-- and set_top_hero fills slots 1 to 5 before it asks which hero to replace. Existing stars keep their slots.

alter table public.favorite_heroes drop constraint favorite_heroes_top_slot_check;
alter table public.favorite_heroes add constraint favorite_heroes_top_slot_check check (top_slot between 1 and 5);

comment on column public.favorite_heroes.top_slot is
  'Top 5 slot (1 to 5) on this position list, or null. Written only by set_top_hero.';

-- Adds (is_top) or removes one of the signed-in player's heroes from that position's Top 5. With 5 already
-- chosen, replace_hero names the one the new hero takes the place of, in one step. Returns
-- {position, top: [hero ids in slot order]}. Raises P0001 'top_full' when the Top 5 is full and no replace_hero is given.
create or replace function public.set_top_hero(
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

  -- Already in the Top 5: nothing to do, so a second tap never asks which hero to replace.
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
      raise exception 'That hero is not in your Top 5' using errcode = '22023';
    end if;
    update public.favorite_heroes f set top_slot = null
    where f.user_id = me and f.position = hero_position and f.hero_id = replace_hero;
  else
    select s into slot from generate_series(1, 5) s
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
