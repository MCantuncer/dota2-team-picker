-- Co-captains. A team's owner can make any member a co-captain, so someone
-- else can run the draft when the owner is away.
--
-- Owner: everything below, plus rename or delete the team and choose who is
-- a co-captain. Co-captain: run the draft (current team), invite people,
-- cancel invites and remove players. A co-captain can't remove the owner or
-- another co-captain, and can't change roles. Players: as before.

alter table public.team_members
  add column role text not null default 'player' check (role in ('player', 'co_captain'));

comment on column public.team_members.role is 'player or co_captain. Only the team owner can change it.';

-- Who sent an invite, so the daily invite limit counts per person, not per team.
alter table public.team_invites
  add column sent_by uuid references public.profiles (id) on delete set null;

create index team_invites_sent_by_idx on public.team_invites (sent_by, sent_at);

-- True when the signed-in user owns the team or is one of its co-captains.
create function public.runs_team(team uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.teams t where t.id = team and t.owner_id = (select auth.uid()))
    or exists (
      select 1 from public.team_members m
      where m.team_id = team and m.user_id = (select auth.uid()) and m.role = 'co_captain'
    )
$$;

-- Owners and co-captains read the names, positions and favorites of the team's members.
create or replace function public.is_my_member(member uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.team_members m
    where m.user_id = member and public.runs_team(m.team_id)
  )
$$;

revoke execute on function public.runs_team from public, anon;
grant execute on function public.runs_team to authenticated;

-- Members: owners and co-captains see the whole team. Only the owner changes roles.
drop policy "Read own membership or own team's members" on public.team_members;
create policy "Read own membership or the members of a team you run" on public.team_members
for select to authenticated using ((select auth.uid()) = user_id or public.runs_team(team_id));

drop policy "Leave a team or remove a member" on public.team_members;
create policy "Leave a team or remove a member" on public.team_members
for delete to authenticated using (
  (select auth.uid()) = user_id
  or public.owns_team(team_id)
  or (role = 'player' and public.runs_team(team_id))
);

revoke insert, update on public.team_members from anon, authenticated;
grant update (role) on public.team_members to authenticated;

create policy "Owners set member roles" on public.team_members
for update to authenticated using (public.owns_team(team_id)) with check (public.owns_team(team_id));

-- Invites and the current team: owners and co-captains.
drop policy "Read own team's invites" on public.team_invites;
create policy "Read invites of a team you run" on public.team_invites
for select to authenticated using (public.runs_team(team_id));

drop policy "Cancel own team's invites" on public.team_invites;
create policy "Cancel invites of a team you run" on public.team_invites
for delete to authenticated using (public.runs_team(team_id));

drop policy "Manage own team's lineup" on public.team_lineups;
create policy "Manage the lineup of a team you run" on public.team_lineups
for all to authenticated
using (public.runs_team(team_id))
with check (public.runs_team(team_id));
