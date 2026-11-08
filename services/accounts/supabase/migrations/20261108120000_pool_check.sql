-- Pool Check: catch suggestion lists that show heroes from outside a player's pool.
--
-- Each saved party list now says which rule built it, and the server works out which of the
-- shown heroes were outside the player's own heroes for that position (favorite_heroes at the
-- position or at 0, the "any position" list) when the list was saved:
--   list_rule 'pool': built from the player's own heroes, so outside must be empty;
--   list_rule 'any': the player had no heroes left for the position, so any hero may show.
-- A 'pool' list with outside heroes is a slip in the website's rule, and the admin Pool Check
-- page lists it. Rows saved before this change, or by an older page, have neither value.

alter table public.draft_suggestions
  add column list_rule text check (list_rule in ('pool', 'any')),
  add column outside smallint[];

-- The same function with the rule added at the end, so an older page that leaves it out still saves.
drop function public.save_draft_suggestions(uuid, smallint, smallint[], real[], real);

create function public.save_draft_suggestions(
  draft uuid,
  pos smallint,
  shown smallint[],
  shown_scores real[],
  chance real default null,
  rule text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  outsiders smallint[];
begin
  if not public.in_draft_party(draft) then
    raise exception 'Draft not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.party_drafts where id = draft and ended_at is null) then
    raise exception 'This draft has ended' using errcode = 'P0002';
  end if;
  -- In the order shown, so the first outsider is the highest one on the list.
  outsiders := array(
    select s.hero
    from unnest(shown) with ordinality as s (hero, n)
    where not exists (
      select 1 from public.favorite_heroes f
      where f.user_id = me and f.position in (pos, 0) and f.hero_id = s.hero
    )
    order by s.n
  );
  insert into public.draft_suggestions (draft_id, user_id, position, heroes, scores, win_chance, list_rule, outside)
  values (draft, me, pos, shown, shown_scores, chance, rule, outsiders)
  on conflict (draft_id, user_id) do update
    set position = excluded.position, heroes = excluded.heroes, scores = excluded.scores,
      win_chance = excluded.win_chance, list_rule = excluded.list_rule, outside = excluded.outside,
      updated_at = now();
end;
$$;

revoke execute on function public.save_draft_suggestions from public, anon;
grant execute on function public.save_draft_suggestions to authenticated;

-- One row for the admin page: the lists saved in the last `days` days, by rule. slips counts the
-- 'pool' lists that showed an outside hero, which should always be 0. Admins only; anyone else
-- gets an error, so the page fails closed.
create function public.admin_pool_check(days integer default 7)
returns table (
  lists integer,
  pool_lists integer,
  slips integer,
  any_lists integer,
  unknown_lists integer,
  players integer
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
    raise exception 'Only admins can see the pool check' using errcode = '42501';
  end if;
  if days is null or days not between 1 and 90 then
    raise exception 'days must be between 1 and 90' using errcode = '22023';
  end if;

  return query
  select
    count(*)::integer,
    (count(*) filter (where s.list_rule = 'pool'))::integer,
    (count(*) filter (where s.list_rule = 'pool' and cardinality(s.outside) > 0))::integer,
    (count(*) filter (where s.list_rule = 'any'))::integer,
    (count(*) filter (where s.list_rule is null))::integer,
    count(distinct s.user_id)::integer
  from public.draft_suggestions s
  where s.updated_at >= now() - make_interval(days => days);
end;
$$;

-- The latest slips, newest first: whose list it was, the position, the list and its outside heroes.
create function public.admin_pool_slips(max_rows integer default 20)
returns table (
  draft_id uuid,
  user_id uuid,
  display_name text,
  "position" smallint,
  heroes smallint[],
  outside smallint[],
  updated_at timestamptz
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
    raise exception 'Only admins can see the pool check' using errcode = '42501';
  end if;
  if max_rows is null or max_rows not between 1 and 50 then
    raise exception 'max_rows must be between 1 and 50' using errcode = '22023';
  end if;

  return query
  select s.draft_id, s.user_id, p.display_name, s.position, s.heroes, s.outside, s.updated_at
  from public.draft_suggestions s
  join public.profiles p on p.id = s.user_id
  where s.list_rule = 'pool' and cardinality(s.outside) > 0
  order by s.updated_at desc, s.draft_id, s.user_id
  limit max_rows;
end;
$$;

revoke execute on function public.admin_pool_check, public.admin_pool_slips from public, anon;
grant execute on function public.admin_pool_check, public.admin_pool_slips to authenticated;
