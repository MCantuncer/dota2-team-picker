-- Two Stack changes.
--
-- 1. Best Position: the Stack Lineup showed each player's main position as the one with the most heroes saved,
--    so a player with a long Pos 4 list but who plays mid showed as Pos 4. stack_player_stats now also returns
--    `played`, games per position over the player's last 20 games ({"2": 14, "4": 3}; games with no known
--    position are left out), and the site picks the position they actually play most.
-- 2. Stack cards: browse_stacks and hot_stacks also return the owner's avatar and the Stack's average rank
--    (rank_tier form, null when nobody has a rank), so a card can show who runs it and how strong it is. The
--    average is one number over every player: it does not say who is in the Stack, which stays hidden.
--
-- Adding output columns changes the return types, so each function is dropped and created again here with its
-- grants. hot_stacks reads browse_stacks, so it is dropped first.

-- Games per position over a player's last 20 games: {"2": 14, "4": 3}. Internal; callers check access.
create function public.positions_played(player uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(g.position, g.games), '{}'::jsonb)
  from (
    select l.position, count(*)::int as games
    from (
      select f.position from public.player_game_facts f
      where f.user_id = player
      order by f.started_at desc
      limit 20
    ) l
    where l.position is not null
    group by l.position
  ) g;
$$;

revoke execute on function public.positions_played from public, anon, authenticated;

-- One Stack's average rank in rank_tier form, the way the site's banner averages it: each rank is a step
-- (Herald 1 = 0 ... Divine 5 = 34, Immortal = 35), the steps are averaged and rounded, and the result turned
-- back into a rank_tier. Null when no player has a rank. Internal.
create function public.stack_average_rank(team uuid)
returns smallint
language sql
stable
set search_path = ''
as $$
  with players as (
    select t.owner_id as user_id from public.teams t where t.id = team
    union
    select m.user_id from public.team_members m where m.team_id = team
  ),
  steps as (
    select case when p.rank_tier >= 80 then 35
      else (p.rank_tier / 10 - 1) * 5 + least(greatest(p.rank_tier % 10, 1), 5) - 1 end as step
    from players x
    join public.profiles p on p.id = x.user_id
    where p.rank_tier between 11 and 80
  ),
  average as (select round(avg(s.step))::int as step from steps s)
  select case when a.step is null then null
    when a.step >= 35 then 80
    else ((a.step / 5 + 1) * 10 + a.step % 5 + 1) end::smallint
  from average a
$$;

revoke execute on function public.stack_average_rank from public, anon, authenticated;

drop function public.stack_player_stats(uuid);
create function public.stack_player_stats(team uuid)
returns table (
  user_id uuid,
  display_name text,
  rank_tier smallint,
  positions smallint[],
  favorites jsonb,
  hero_stats jsonb,
  top jsonb,
  played jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select x.user_id, pr.display_name, pr.rank_tier,
    coalesce((select array_agg(fp.position order by fp.position)
      from public.favorite_positions fp where fp.user_id = x.user_id), '{}'),
    coalesce((select jsonb_object_agg(f.position, f.heroes)
      from (
        select fh.position, jsonb_agg(fh.hero_id order by fh.created_at) as heroes
        from public.favorite_heroes fh where fh.user_id = x.user_id
        group by fh.position
      ) f), '{}'::jsonb),
    pr.hero_stats,
    public.top_by_position(x.user_id),
    public.positions_played(x.user_id)
  from (
    select (select auth.uid()) as user_id, 0 as sort, null::timestamptz as since
    union all
    -- A Manager is also a member row: they come back once, as the caller.
    select m.user_id, 1, m.joined_at from public.team_members m
    where m.team_id = team and m.user_id <> (select auth.uid())
  ) x
  join public.profiles pr on pr.id = x.user_id
  where public.runs_team(team)
  order by x.sort, x.since
$$;

revoke execute on function public.stack_player_stats from public, anon;
grant execute on function public.stack_player_stats to authenticated;

drop function public.hot_stacks();
drop function public.browse_stacks(text, int);

-- Open Stacks, most games together first, 50 a page. search matches the name, case-insensitive;
-- % and _ in it are matched literally.
create function public.browse_stacks(search text default null, page int default 0)
returns table (id uuid, name text, owner_name text, members int, games int, owner_avatar_url text,
  average_rank smallint)
language sql
stable
security definer
set search_path = ''
as $$
  with open_teams as (
    select t.id, t.name, t.owner_id, t.created_at
    from public.teams t
    where t.open_to_requests
      and (coalesce(trim(search), '') = ''
        or t.name ilike '%' || replace(replace(replace(trim(search), '\', '\\'), '%', '\%'), '_', '\_') || '%')
  ),
  games as (select * from public.stack_games(array(select o.id from open_teams o))),
  shown as (
    select o.id, o.name, p.display_name, p.avatar_url,
      (select count(*)::int from public.team_members m where m.team_id = o.id) + 1 as members,
      coalesce(g.games, 0) as games, o.created_at
    from open_teams o
    join public.profiles p on p.id = o.owner_id
    left join games g on g.team_id = o.id
    order by coalesce(g.games, 0) desc, o.created_at desc
    limit 50 offset greatest(page, 0) * 50
  )
  -- The average is worked out only for the page shown.
  select s.id, s.name, s.display_name, s.members, s.games, s.avatar_url, public.stack_average_rank(s.id)
  from shown s
  order by s.games desc, s.created_at desc
$$;

-- The 10 open Stacks with the most games together in the last 14 days.
create function public.hot_stacks()
returns table (id uuid, name text, owner_name text, members int, games int, owner_avatar_url text,
  average_rank smallint)
language sql
stable
security definer
set search_path = ''
as $$
  select b.id, b.name, b.owner_name, b.members, b.games, b.owner_avatar_url, b.average_rank
  from public.browse_stacks(null, 0) b
  where b.games > 0
  order by b.games desc
  limit 10
$$;

revoke execute on function public.browse_stacks, public.hot_stacks from public, anon;
grant execute on function public.browse_stacks, public.hot_stacks to authenticated;
