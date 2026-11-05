-- Mixed lineups: a player plans a draft for any mix of people from the Stacks they run and their
-- friends, online or not.
--
-- New sharing: accepted friends share their heroes, positions, rank and hero records with each
-- other for drafting. It is on by default and each player can turn it off for themselves
-- (set_share_heroes_with_friends). It is one-way: it only controls what friends get from you.
-- Stack sharing is unchanged: members share with the owner and Managers (is_my_member), and a
-- Manager never gets the owner's heroes.

alter table public.profiles
  add column share_heroes_with_friends boolean not null default true;

comment on column public.profiles.share_heroes_with_friends is
  'Whether accepted friends can plan drafts with this player''s heroes, positions, rank and hero records.';

-- The "Share My Heroes With Friends" switch. Changes only the caller's own row.
create function public.set_share_heroes_with_friends(is_on boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if is_on is null then
    raise exception 'Choose on or off' using errcode = '22023';
  end if;
  update public.profiles set share_heroes_with_friends = is_on where id = me;
end;
$$;

revoke execute on function public.set_share_heroes_with_friends from public, anon;
grant execute on function public.set_share_heroes_with_friends to authenticated;

-- Everyone the caller can put in a lineup, once each, never the caller:
--   * the members of every Stack the caller runs (owner or Manager), shared as before;
--   * the owner of every Stack the caller runs as a Manager, NOT shared (as before);
--   * every accepted friend, shared when they share with friends.
-- Being reached through a shared path wins. Unshared rows keep only name and avatar.
-- `stacks` lists the caller-run Stacks each person is in, with their role there.
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
  shared boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select (select auth.uid()) as id),
  run as (
    select t.id, t.name, t.owner_id from public.teams t where public.runs_team(t.id)
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
    x.stacks, x.is_friend, x.shared
  from people x
  join public.profiles pr on pr.id = x.user_id
  where (select id from me) is not null
  order by pr.display_name, x.user_id
$$;

revoke execute on function public.lineup_players from public, anon;
grant execute on function public.lineup_players to authenticated;
