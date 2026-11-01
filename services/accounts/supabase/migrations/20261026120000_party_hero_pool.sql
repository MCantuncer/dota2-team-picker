-- The party leader's WCST view plans all five heroes from every member's favorites, so the
-- leader can read the favorite heroes of the people in their open party. Nobody else can,
-- and the leader sees them only while those players are in the party.
create function public.party_hero_pool()
returns table (user_id uuid, "position" smallint, hero_id smallint)
language sql
stable
security definer
set search_path = ''
as $$
  select f.user_id, f.position, f.hero_id
  from public.parties p
  join public.party_members m on m.party_id = p.id
  join public.favorite_heroes f on f.user_id = m.user_id
  where p.id = public.my_party() and p.leader_id = (select auth.uid()) and p.closed_at is null
  order by f.user_id, f.position, f.created_at
$$;

revoke execute on function public.party_hero_pool from public, anon;
grant execute on function public.party_hero_pool to authenticated;
