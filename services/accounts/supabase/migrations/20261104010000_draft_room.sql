-- Draft Room: every party member sees the planner's screen (the Draft Captain, else the party
-- leader), with the same numbers on every screen.
--
-- - parties.rank_bracket is the party rank that Team Plan, Per Player, win chance and the game
--   plan use for everyone in the party. Null means the planner's own rank. Only the planner sets it.
-- - party_player_stats() gives every member of an open party each member's positions, favorite
--   heroes, match stats and rank. Party members chose to play together, and the lobby says so;
--   nobody outside the party gets any of it.

alter table public.parties add column rank_bracket smallint check (rank_bracket between 1 and 8);

comment on column public.parties.rank_bracket is 'Party rank (1 Herald to 8 Immortal) the planner chose for every screen, or null for the planner''s own rank.';

-- Set the party rank of your open party. Only the planner may; null goes back to their own rank.
create function public.set_party_rank(bracket smallint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  party uuid := public.my_party();
begin
  if party is null then
    raise exception 'You are not in a party.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.parties p
    where p.id = party and coalesce(p.captain_id, p.leader_id) = (select auth.uid())
  ) then
    raise exception 'Only the Draft Captain, or the leader when there is none, sets the party rank.' using errcode = '42501';
  end if;
  if bracket is not null and bracket not between 1 and 8 then
    raise exception 'Pick a rank from Herald to Immortal.' using errcode = '22023';
  end if;
  update public.parties set rank_bracket = bracket where id = party;
end;
$$;

-- Every member of your open party with their positions, favorite heroes (position to hero ids, in
-- the order they were added), match stats per hero and rank tier.
create function public.party_player_stats()
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
  select m.user_id, pr.display_name, pr.rank_tier,
    coalesce((select array_agg(fp.position order by fp.position)
      from public.favorite_positions fp where fp.user_id = m.user_id), '{}'),
    coalesce((select jsonb_object_agg(f.position, f.heroes)
      from (
        select fh.position, jsonb_agg(fh.hero_id order by fh.created_at) as heroes
        from public.favorite_heroes fh where fh.user_id = m.user_id
        group by fh.position
      ) f), '{}'::jsonb),
    pr.hero_stats
  from public.party_members m
  join public.parties p on p.id = m.party_id
  join public.profiles pr on pr.id = m.user_id
  where m.party_id = public.my_party() and p.closed_at is null
  order by m.user_id <> p.leader_id, m.joined_at
$$;

revoke execute on function public.set_party_rank, public.party_player_stats from public, anon;
grant execute on function public.set_party_rank, public.party_player_stats to authenticated;
