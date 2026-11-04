-- Planning a draft for Stack mates who aren't online: the owner or a Manager (co_captain) of a
-- Stack gets everyone they plan for in one call, with the same columns as party_player_stats().
--
-- Nothing new is shared. Members share their heroes, positions and profile with the owner and
-- Managers of their Stack (is_my_member), so the rows are the caller plus the Stack's accepted
-- members, and only for someone who runs the Stack. A Manager never gets the owner's heroes, and
-- invites or join requests that haven't been accepted are not members.

create function public.stack_player_stats(team uuid)
returns table (
  user_id uuid,
  display_name text,
  rank_tier smallint,
  positions smallint[],
  favorites jsonb,
  hero_stats jsonb
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
    pr.hero_stats
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
