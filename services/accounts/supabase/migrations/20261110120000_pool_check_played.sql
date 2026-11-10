-- Pool Check for the "played" list rule (Can, 2026-11-10: Top 5 is a player's best heroes, not their only
-- ones). A list may now hold the player's own heroes for the position plus heroes they have played, so a
-- saved list says which rule built it:
--   list_rule 'pool':   only the player's own heroes; outside = heroes not in favorite_heroes at the
--                       position or at 0 (unchanged).
--   list_rule 'played': the player's own heroes plus heroes they played at least 10 games in the six months
--                       of profiles.hero_stats (the website's PLAYED_MIN); outside = heroes that are neither.
--   list_rule 'any':    the player had no heroes left, so any hero may show (unchanged).
-- `outside` therefore means "heroes the rule did not allow", and a 'pool' or 'played' list with any is a slip.

alter table public.draft_suggestions drop constraint draft_suggestions_list_rule_check;
alter table public.draft_suggestions
  add constraint draft_suggestions_list_rule_check check (list_rule in ('pool', 'played', 'any'));

-- Same signature as before, so the grants stay as they are.
create or replace function public.save_draft_suggestions(
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
  played jsonb := '{}'::jsonb;
  outsiders smallint[];
begin
  if not public.in_draft_party(draft) then
    raise exception 'Draft not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.party_drafts where id = draft and ended_at is null) then
    raise exception 'This draft has ended' using errcode = 'P0002';
  end if;
  if rule = 'played' then
    select coalesce(p.hero_stats, '{}'::jsonb) into played from public.profiles p where p.id = me;
  end if;
  -- In the order shown, so the first outsider is the highest one on the list.
  outsiders := array(
    select s.hero
    from unnest(shown) with ordinality as s (hero, n)
    where not exists (
      select 1 from public.favorite_heroes f
      where f.user_id = me and f.position in (pos, 0) and f.hero_id = s.hero
    )
    -- A played hero needs a number of games; anything else in the JSON, or no rule, counts as not played.
    -- CASE, so the cast only runs on a number and a missing rule or hero reads as false, never null.
    and not (
      case
        when rule = 'played' and jsonb_typeof(played -> s.hero::text -> 'games') = 'number'
          then (played -> s.hero::text ->> 'games')::numeric >= 10
        else false
      end
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

-- A new column, so the function is dropped and made again, with its grants.
drop function public.admin_pool_check(integer);

-- One row for the admin page: the lists saved in the last `days` days, by rule. slips counts the 'pool'
-- and 'played' lists that showed a hero their rule did not allow, which should always be 0. Admins only;
-- anyone else gets an error, so the page fails closed.
create function public.admin_pool_check(days integer default 7)
returns table (
  lists integer,
  pool_lists integer,
  played_lists integer,
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
    (count(*) filter (where s.list_rule = 'played'))::integer,
    (count(*) filter (where s.list_rule in ('pool', 'played') and cardinality(s.outside) > 0))::integer,
    (count(*) filter (where s.list_rule = 'any'))::integer,
    (count(*) filter (where s.list_rule is null))::integer,
    count(distinct s.user_id)::integer
  from public.draft_suggestions s
  where s.updated_at >= now() - make_interval(days => days);
end;
$$;

revoke execute on function public.admin_pool_check from public, anon;
grant execute on function public.admin_pool_check to authenticated;

-- The latest slips, newest first, now from 'played' lists too. Same signature, so the grants stay.
create or replace function public.admin_pool_slips(max_rows integer default 20)
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
  where s.list_rule in ('pool', 'played') and cardinality(s.outside) > 0
  order by s.updated_at desc, s.draft_id, s.user_id
  limit max_rows;
end;
$$;
