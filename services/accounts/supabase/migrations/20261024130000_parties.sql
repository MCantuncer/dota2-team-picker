-- Parties, like a party in Dota. Any player starts one and becomes its
-- leader, invites friends and teammates, and up to 5 people join for a game.
-- Invites show up live on the invitee's screen (Supabase Realtime), so the
-- tables below are in the realtime publication; row level security decides
-- who receives which change.
--
-- A player is in at most one open party. Starting or joining another one
-- takes them out of the old one. Everything that changes a party goes through
-- the functions below; the tables are read-only to users.

create table public.parties (
  id uuid primary key default gen_random_uuid(),
  leader_id uuid not null references public.profiles (id) on delete cascade,
  -- The team it was started from, if any (for its lineup and favorites).
  team_id uuid references public.teams (id) on delete set null,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create index parties_leader_id_idx on public.parties (leader_id) where closed_at is null;

create table public.party_members (
  party_id uuid not null references public.parties (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- The position they want this game, 1 carry ... 5 hard support; null = any.
  position smallint check (position between 1 and 5),
  joined_at timestamptz not null default now(),
  primary key (party_id, user_id)
);

create index party_members_user_id_idx on public.party_members (user_id);

create table public.party_invites (
  party_id uuid not null references public.parties (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  invited_by uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  primary key (party_id, user_id)
);

create index party_invites_user_id_idx on public.party_invites (user_id) where status = 'pending';

-- The party the signed-in user is in right now, if any.
create function public.my_party()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.party_id from public.party_members m join public.parties p on p.id = m.party_id
  where m.user_id = (select auth.uid()) and p.closed_at is null
  limit 1
$$;

create function public.in_party(party uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.party_members m where m.party_id = party and m.user_id = (select auth.uid()))
$$;

create function public.invited_to_party(party uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.party_invites i where i.party_id = party and i.user_id = (select auth.uid()))
$$;

-- True when the signed-in user may invite this player: an accepted friend, or someone from one of their teams.
create function public.can_invite(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select (select auth.uid()) as id),
  my_teams as (
    select t.id from public.teams t, me where t.owner_id = me.id
    union
    select m.team_id from public.team_members m, me where m.user_id = me.id
  )
  select exists (
    select 1 from public.friendships f, me
    where f.status = 'accepted'
      and ((f.requester_id = me.id and f.addressee_id = target) or (f.addressee_id = me.id and f.requester_id = target))
  ) or exists (
    select 1 from public.team_members m join my_teams mt on mt.id = m.team_id where m.user_id = target
  ) or exists (
    select 1 from public.teams t join my_teams mt on mt.id = t.id where t.owner_id = target
  )
$$;

alter table public.parties enable row level security;
alter table public.party_members enable row level security;
alter table public.party_invites enable row level security;
revoke insert, update, delete on public.parties, public.party_members, public.party_invites from anon, authenticated;

create policy "Read parties you are in or invited to" on public.parties
for select to authenticated using (public.in_party(id) or public.invited_to_party(id));

create policy "Read the members of your party" on public.party_members
for select to authenticated using (public.in_party(party_id) or public.invited_to_party(party_id));

create policy "Read your invites and your party's" on public.party_invites
for select to authenticated using ((select auth.uid()) = user_id or public.in_party(party_id));

-- Takes the signed-in user out of their open party. If they led it, the
-- player who joined next becomes leader; the last one out closes it.
create function public.leave_party()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  party uuid := public.my_party();
  next_leader uuid;
begin
  if party is null then
    return;
  end if;
  perform 1 from public.parties where id = party for update;
  delete from public.party_members where party_id = party and user_id = me;
  select user_id into next_leader from public.party_members where party_id = party order by joined_at limit 1;
  if next_leader is null then
    update public.parties set closed_at = now() where id = party;
  else
    update public.parties set leader_id = next_leader where id = party and leader_id = me;
  end if;
end;
$$;

-- Starts a party with the signed-in user as leader. Returns its id.
create function public.start_party(team uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  new_id uuid;
begin
  if me is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if team is not null and not (public.owns_team(team) or public.is_team_member(team)) then
    raise exception 'Team not found' using errcode = 'P0002';
  end if;
  perform public.leave_party();
  insert into public.parties (leader_id, team_id) values (me, team) returning id into new_id;
  insert into public.party_members (party_id, user_id) values (new_id, me);
  return new_id;
end;
$$;

-- Invites a friend or teammate to the signed-in user's party (the leader only).
create function public.invite_to_party(target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  party uuid;
begin
  select id into party from public.parties where leader_id = me and closed_at is null;
  if party is null then
    raise exception 'Start a party first' using errcode = 'P0002';
  end if;
  if target = me or not public.can_invite(target) then
    raise exception 'You can invite friends and teammates only' using errcode = '42501';
  end if;
  if exists (select 1 from public.party_members where party_id = party and user_id = target) then
    return;
  end if;
  if (select count(*) from public.party_invites where invited_by = me and created_at > now() - interval '1 hour') >= 60 then
    raise exception 'Too many invites. Try again in a while.' using errcode = '54000';
  end if;
  -- Inviting again re-sends it, so it pops up once more.
  delete from public.party_invites where party_id = party and user_id = target;
  insert into public.party_invites (party_id, user_id, invited_by) values (party, target, me);
end;
$$;

-- Accepts or declines an invite. Accepting joins the party (5 at most) and leaves any other one.
create function public.answer_party_invite(party uuid, accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  if not exists (
    select 1 from public.party_invites i join public.parties p on p.id = i.party_id
    where i.party_id = party and i.user_id = me and i.status = 'pending' and p.closed_at is null
  ) then
    raise exception 'This invite is no longer open' using errcode = 'P0002';
  end if;
  if not accept then
    update public.party_invites set status = 'declined' where party_id = party and user_id = me;
    return;
  end if;
  -- Locks the party so two players can't both take the fifth spot.
  perform 1 from public.parties where id = party for update;
  if (select count(*) from public.party_members where party_id = party) >= 5 then
    raise exception 'The party is full' using errcode = '54000';
  end if;
  if party is distinct from public.my_party() then
    perform public.leave_party();
    insert into public.party_members (party_id, user_id) values (party, me);
  end if;
  update public.party_invites set status = 'accepted' where party_id = party and user_id = me;
end;
$$;

-- Sets the position the signed-in user wants in their party this game (null = any).
create function public.set_party_position(want smallint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.party_members set position = want
  where user_id = (select auth.uid()) and party_id = public.my_party();
end;
$$;

-- Removes a member from the signed-in user's party (the leader only).
create function public.remove_from_party(target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.party_members m using public.parties p
  where p.id = m.party_id and p.leader_id = (select auth.uid()) and p.closed_at is null
    and m.user_id = target and target <> (select auth.uid());
end;
$$;

-- The lobby: everyone in the signed-in user's open party, leader first.
create function public.party_view()
returns table (
  party_id uuid,
  leader_id uuid,
  team_id uuid,
  user_id uuid,
  display_name text,
  avatar_url text,
  "position" smallint,
  joined_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.leader_id, p.team_id, m.user_id, pr.display_name, pr.avatar_url, m.position, m.joined_at
  from public.parties p
  join public.party_members m on m.party_id = p.id
  join public.profiles pr on pr.id = m.user_id
  where p.id = public.my_party()
  order by m.user_id <> p.leader_id, m.joined_at
$$;

-- Open invites to the signed-in user, newest first, with who sent them and how full the party is.
create function public.my_party_invites()
returns table (party_id uuid, invited_by uuid, inviter_name text, inviter_avatar_url text, members int, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select i.party_id, i.invited_by, pr.display_name, pr.avatar_url,
    (select count(*)::int from public.party_members m where m.party_id = i.party_id), i.created_at
  from public.party_invites i
  join public.parties p on p.id = i.party_id and p.closed_at is null
  join public.profiles pr on pr.id = i.invited_by
  where i.user_id = (select auth.uid()) and i.status = 'pending'
    and i.party_id is distinct from public.my_party()
  order by i.created_at desc
$$;

revoke execute on function public.my_party, public.in_party, public.invited_to_party, public.can_invite,
  public.leave_party, public.start_party, public.invite_to_party, public.answer_party_invite,
  public.set_party_position, public.remove_from_party, public.party_view, public.my_party_invites from public, anon;
grant execute on function public.my_party, public.in_party, public.invited_to_party, public.can_invite,
  public.leave_party, public.start_party, public.invite_to_party, public.answer_party_invite,
  public.set_party_position, public.remove_from_party, public.party_view, public.my_party_invites to authenticated;

-- Live updates for the lobby and the invite pop-up.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.parties, public.party_members, public.party_invites;
  end if;
end;
$$;
