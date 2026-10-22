-- Teams for Captain mode, and favorite heroes per position.
--
-- A captain owns a team and invites friends by email. A friend who accepts
-- becomes a team member with a normal account. Members pick the positions
-- they like and their heroes for each position. The captain can read the
-- names, positions and favorites of their own members, nothing else, and
-- picks the current team (1 to 5 members, each on a position) per game.

-- Favorite heroes per position. 0 means any position, which the profile page uses.
alter table public.favorite_heroes
  add column position smallint not null default 0 check (position between 0 and 5);
alter table public.favorite_heroes drop constraint favorite_heroes_pkey;
alter table public.favorite_heroes add primary key (user_id, position, hero_id);
alter table public.favorite_heroes enable row level security;

-- Positions a user likes to play, 1 carry ... 5 hard support.
create table public.favorite_positions (
  user_id uuid not null references public.profiles (id) on delete cascade,
  position smallint not null check (position between 1 and 5),
  created_at timestamptz not null default now(),
  primary key (user_id, position)
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  created_at timestamptz not null default now()
);

create index teams_owner_id_idx on public.teams (owner_id);

create table public.team_members (
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create index team_members_user_id_idx on public.team_members (user_id);

-- An invite's id is the secret in the join link, so it is random and never listed to others.
create table public.team_invites (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  email text not null check (email = lower(email) and email like '%_@_%'),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (team_id, email)
);

-- The current team: which member plays which position this game, and the party rank.
create table public.team_lineups (
  team_id uuid primary key references public.teams (id) on delete cascade,
  -- Five entries, one per position; null means someone outside the team.
  slots uuid[] not null default array[null, null, null, null, null]::uuid[] check (cardinality(slots) = 5),
  -- Rank bracket 1 Herald ... 8 Immortal, null for all ranks.
  rank_bracket smallint check (rank_bracket between 1 and 8),
  updated_at timestamptz not null default now()
);

create trigger team_lineups_touch_updated_at
before update on public.team_lineups
for each row execute function public.touch_updated_at();

-- Helpers for the policies below. They run as the table owner so policies
-- can look at teams without checking the same policies again.
create function public.owns_team(team uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.teams t where t.id = team and t.owner_id = (select auth.uid()))
$$;

create function public.is_team_member(team uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.team_members m where m.team_id = team and m.user_id = (select auth.uid()))
$$;

-- True when the signed-in user captains a team that this user is a member of.
create function public.is_my_member(member uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.team_members m join public.teams t on t.id = m.team_id
    where m.user_id = member and t.owner_id = (select auth.uid())
  )
$$;

-- What the join page shows before the user accepts: the team, its captain and who was invited.
create function public.get_team_invite(invite uuid)
returns table (team_name text, captain_name text, email text, accepted boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select t.name, p.display_name, i.email, i.accepted_at is not null
  from public.team_invites i
  join public.teams t on t.id = i.team_id
  join public.profiles p on p.id = t.owner_id
  where i.id = invite
$$;

-- Joins the team, if the signed-in user's email is the one invited. Returns the team id.
create function public.accept_team_invite(invite uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  found public.team_invites;
begin
  select * into found from public.team_invites where id = invite;
  if found.id is null then
    raise exception 'Invite not found' using errcode = 'P0002';
  end if;
  if found.email <> lower(coalesce((select auth.jwt() ->> 'email'), '')) then
    raise exception 'This invite is for %', found.email using errcode = '42501';
  end if;
  insert into public.team_members (team_id, user_id) values (found.team_id, (select auth.uid()))
  on conflict do nothing;
  update public.team_invites set accepted_at = coalesce(accepted_at, now()) where id = invite;
  return found.team_id;
end;
$$;

revoke execute on function public.owns_team, public.is_team_member, public.is_my_member, public.accept_team_invite from public, anon;
grant execute on function public.owns_team, public.is_team_member, public.is_my_member, public.accept_team_invite to authenticated;
grant execute on function public.get_team_invite to anon, authenticated;

alter table public.favorite_positions enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.team_invites enable row level security;
alter table public.team_lineups enable row level security;

-- Users manage their own favorite positions; captains read their members'.
create policy "Read own or members' positions" on public.favorite_positions
for select to authenticated using ((select auth.uid()) = user_id or public.is_my_member(user_id));

create policy "Add own positions" on public.favorite_positions
for insert to authenticated with check ((select auth.uid()) = user_id);

create policy "Remove own positions" on public.favorite_positions
for delete to authenticated using ((select auth.uid()) = user_id);

-- Captains also read their members' favorite heroes and names.
create policy "Captains read members' favorites" on public.favorite_heroes
for select to authenticated using (public.is_my_member(user_id));

create policy "Captains read members' profiles" on public.profiles
for select to authenticated using (public.is_my_member(id));

-- Teams: the owner manages them, members can see the teams they are in.
create policy "Read own or joined teams" on public.teams
for select to authenticated using ((select auth.uid()) = owner_id or public.is_team_member(id));

create policy "Create own teams" on public.teams
for insert to authenticated with check ((select auth.uid()) = owner_id);

create policy "Rename own teams" on public.teams
for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);

create policy "Delete own teams" on public.teams
for delete to authenticated using ((select auth.uid()) = owner_id);

-- Members join only through accept_team_invite. The captain can remove anyone, members can leave.
create policy "Read own membership or own team's members" on public.team_members
for select to authenticated using ((select auth.uid()) = user_id or public.owns_team(team_id));

create policy "Leave a team or remove a member" on public.team_members
for delete to authenticated using ((select auth.uid()) = user_id or public.owns_team(team_id));

-- Invites are created and emailed by the team-invite function. The captain sees and cancels them.
create policy "Read own team's invites" on public.team_invites
for select to authenticated using (public.owns_team(team_id));

create policy "Cancel own team's invites" on public.team_invites
for delete to authenticated using (public.owns_team(team_id));

create policy "Manage own team's lineup" on public.team_lineups
for all to authenticated
using (public.owns_team(team_id))
with check (public.owns_team(team_id));

-- Pending "link my Steam account" requests, used only by the steam-link function.
create table public.steam_link_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  next text not null default '/profile',
  created_at timestamptz not null default now()
);

alter table public.steam_link_requests enable row level security;
