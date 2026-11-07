-- Top 3 for the other players in a draft: Party, Stack planning and mixed lineups now also return each
-- player's Top 3 per position (`top`, hero ids in slot order, same shape as `favorites`), so their picks
-- get the same small push as the caller's own. `favorites` is unchanged. Adding an output column changes
-- the return type, so each function is dropped and created again in this one migration, with its grants.
-- lineup_players shows `top` only when it shows `favorites` (the player shares with the caller).

-- Each position's Top 3 for a player: {"2": [74, 76]}. Internal; the functions below check access.
create function public.top_by_position(player uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(t.position, t.heroes), '{}'::jsonb)
  from (
    select fh.position, jsonb_agg(fh.hero_id order by fh.top_slot) as heroes
    from public.favorite_heroes fh where fh.user_id = player and fh.top_slot is not null
    group by fh.position
  ) t;
$$;

revoke execute on function public.top_by_position from public, anon, authenticated;

drop function public.party_player_stats();
create function public.party_player_stats()
returns table (
  user_id uuid,
  display_name text,
  rank_tier smallint,
  positions smallint[],
  favorites jsonb,
  hero_stats jsonb,
  top jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id, pr.display_name, pr.rank_tier,
    coalesce((select array_agg(fp.position order by fp.position)
      from public.favorite_positions fp where fp.user_id = m.user_id), '{}'),
    coalesce((select jsonb_object_agg(f.position, f.heroes)
      from (
        select fh.position, jsonb_agg(fh.hero_id order by fh.created_at) as heroes
        from public.favorite_heroes fh where fh.user_id = m.user_id
        group by fh.position
      ) f), '{}'::jsonb),
    pr.hero_stats,
    public.top_by_position(m.user_id)
  from public.party_members m
  join public.parties p on p.id = m.party_id
  join public.profiles pr on pr.id = m.user_id
  where m.party_id = public.my_party() and p.closed_at is null
  order by m.user_id <> p.leader_id, m.joined_at
$$;

revoke execute on function public.party_player_stats from public, anon;
grant execute on function public.party_player_stats to authenticated;

drop function public.stack_player_stats(uuid);
create function public.stack_player_stats(team uuid)
returns table (
  user_id uuid,
  display_name text,
  rank_tier smallint,
  positions smallint[],
  favorites jsonb,
  hero_stats jsonb,
  top jsonb
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
    public.top_by_position(x.user_id)
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

drop function public.lineup_players();
create function public.lineup_players()
returns table (
  user_id uuid,
  display_name text,
  avatar_url text,
  rank_tier smallint,
  positions smallint[],
  favorites jsonb,
  hero_stats jsonb,
  stacks jsonb,
  is_friend boolean,
  shared boolean,
  top jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select (select auth.uid()) as id),
  run as (
    -- The same rule as runs_team(), without calling it for every Stack.
    select t.id, t.name, t.owner_id from public.teams t
    where t.owner_id = (select id from me)
      or t.id in (select m.team_id from public.team_members m
        where m.user_id = (select id from me) and m.role = 'co_captain')
  ),
  links as (
    -- Members of a Stack the caller runs.
    select m.user_id, r.id as team_id, r.name, m.joined_at, m.role, true as shared, false as friend
    from run r join public.team_members m on m.team_id = r.id
    union all
    -- The owner, for a Manager. Owners never have a member row.
    select r.owner_id, r.id, r.name, null::timestamptz, 'owner', false, false
    from run r where r.owner_id <> (select id from me)
    union all
    -- Accepted friends.
    select p.id, null::uuid, null, null::timestamptz, null, p.share_heroes_with_friends, true
    from public.friendships f
    join public.profiles p
      on p.id = case when f.requester_id = (select id from me) then f.addressee_id else f.requester_id end
    where f.status = 'accepted' and (select id from me) in (f.requester_id, f.addressee_id)
  ),
  people as (
    select l.user_id,
      bool_or(l.shared) as shared,
      bool_or(l.friend) as is_friend,
      coalesce(
        jsonb_agg(jsonb_build_object('id', l.team_id, 'name', l.name, 'joined_at', l.joined_at, 'role', l.role)
          order by l.name, l.team_id) filter (where l.team_id is not null),
        '[]'::jsonb) as stacks
    from links l
    where l.user_id <> (select id from me)
    group by l.user_id
  )
  select x.user_id, pr.display_name, pr.avatar_url,
    case when x.shared then pr.rank_tier end,
    case when x.shared then coalesce((select array_agg(fp.position order by fp.position)
      from public.favorite_positions fp where fp.user_id = x.user_id), '{}') else '{}' end,
    case when x.shared then coalesce((select jsonb_object_agg(f.position, f.heroes)
      from (
        select fh.position, jsonb_agg(fh.hero_id order by fh.created_at) as heroes
        from public.favorite_heroes fh where fh.user_id = x.user_id
        group by fh.position
      ) f), '{}'::jsonb) else '{}'::jsonb end,
    case when x.shared then coalesce(pr.hero_stats, '{}'::jsonb) else '{}'::jsonb end,
    x.stacks, x.is_friend, x.shared,
    case when x.shared then public.top_by_position(x.user_id) else '{}'::jsonb end
  from people x
  join public.profiles pr on pr.id = x.user_id
  where (select id from me) is not null
  order by pr.display_name, x.user_id
$$;

revoke execute on function public.lineup_players from public, anon;
grant execute on function public.lineup_players to authenticated;
