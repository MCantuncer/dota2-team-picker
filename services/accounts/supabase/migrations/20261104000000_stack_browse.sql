-- Browsing Stacks (the teams table): a list of open Stacks with search, Hot Stacks, and one Stack's
-- page. Everything here returns public fields only (name, owner name, member count, games played
-- together); members' heroes and positions stay behind the existing row level security.
--
-- "Games together" counts party drafts from the last 14 days that have a match attached and that
-- at least 3 of the Stack's players played (2 for a Stack of 2), at most one per Stack per hour,
-- so a few accounts cannot climb Hot Stacks by starting and ending drafts in a loop.

-- Games each Stack played together in the last 14 days. Internal: callers below pick the Stacks.
create function public.stack_games(teams uuid[])
returns table (team_id uuid, games int)
language sql
stable
security definer
set search_path = ''
as $$
  with players as (
    select t.id as team_id, t.owner_id as user_id from public.teams t where t.id = any(teams)
    union
    select m.team_id, m.user_id from public.team_members m where m.team_id = any(teams)
  ),
  sizes as (
    select p.team_id, count(*) as size from players p group by p.team_id
  ),
  together as (
    select p.team_id, d.created_at, count(*) as players
    from public.party_drafts d
    join public.draft_players dp on dp.draft_id = d.id
    join players p on p.user_id = dp.user_id
    where d.match_id is not null and d.created_at > now() - interval '14 days'
    group by p.team_id, d.id, d.created_at
  )
  select s.team_id, count(distinct date_trunc('hour', g.created_at))::int
  from sizes s
  join together g on g.team_id = s.team_id
  where s.size >= 2 and g.players >= least(3, s.size)
  group by s.team_id
$$;

revoke execute on function public.stack_games from public, anon, authenticated;

-- Open Stacks, most games together first, 50 a page. search matches the name, case-insensitive;
-- % and _ in it are matched literally.
create function public.browse_stacks(search text default null, page int default 0)
returns table (id uuid, name text, owner_name text, members int, games int)
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
  games as (select * from public.stack_games(array(select o.id from open_teams o)))
  select o.id, o.name, p.display_name,
    (select count(*)::int from public.team_members m where m.team_id = o.id) + 1,
    coalesce(g.games, 0)
  from open_teams o
  join public.profiles p on p.id = o.owner_id
  left join games g on g.team_id = o.id
  order by coalesce(g.games, 0) desc, o.created_at desc
  limit 50 offset greatest(page, 0) * 50
$$;

-- The 10 open Stacks with the most games together in the last 14 days.
create function public.hot_stacks()
returns table (id uuid, name text, owner_name text, members int, games int)
language sql
stable
security definer
set search_path = ''
as $$
  select b.id, b.name, b.owner_name, b.members, b.games
  from public.browse_stacks(null, 0) b
  where b.games > 0
  order by b.games desc
  limit 10
$$;

-- One Stack's page: public fields for an open Stack, or for any Stack you are in. my_role is
-- owner, co_captain, player or null; my_request is your open request's id, if any.
create function public.stack_page(team uuid)
returns table (id uuid, name text, owner_name text, members int, games int, open_to_requests boolean,
  my_role text, my_request uuid)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select (select auth.uid()) as id),
  t as (
    select t.*,
      case when t.owner_id = me.id then 'owner'
        else (select m.role from public.team_members m where m.team_id = t.id and m.user_id = me.id) end as my_role
    from public.teams t, me
    where t.id = team
  )
  select t.id, t.name, p.display_name,
    (select count(*)::int from public.team_members m where m.team_id = t.id) + 1,
    coalesce((select g.games from public.stack_games(array[t.id]) g), 0),
    t.open_to_requests, t.my_role,
    (select r.id from public.team_join_requests r, me
     where r.team_id = t.id and r.user_id = me.id and r.status = 'pending')
  from t
  join public.profiles p on p.id = t.owner_id
  where t.open_to_requests or t.my_role is not null
$$;

-- Who is in a Stack, for its members: name, avatar, role and rank. Heroes and positions stay
-- with the owner and Managers.
create function public.stack_members(team uuid)
returns table (user_id uuid, display_name text, avatar_url text, role text, rank_tier smallint)
language sql
stable
security definer
set search_path = ''
as $$
  select x.user_id, p.display_name, p.avatar_url, x.role, p.rank_tier
  from (
    select t.owner_id as user_id, 'owner' as role, t.created_at as since from public.teams t where t.id = team
    union all
    select m.user_id, m.role, m.joined_at from public.team_members m where m.team_id = team
  ) x
  join public.profiles p on p.id = x.user_id
  where public.owns_team(team) or public.is_team_member(team)
  order by x.role = 'owner' desc, x.since
$$;

revoke execute on function public.browse_stacks, public.hot_stacks, public.stack_page, public.stack_members
  from public, anon;
grant execute on function public.browse_stacks, public.hot_stacks, public.stack_page, public.stack_members
  to authenticated;
