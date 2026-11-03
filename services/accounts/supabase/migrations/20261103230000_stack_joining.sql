-- Joining a Stack (the teams table) always ends with a yes, because a member shares their heroes
-- and positions with the owner and co-captains. Two ways in, besides the email invite:
--
--   * Invite a friend: the owner or a co-captain invites an accepted friend; the friend answers
--     Join or Decline on the site (team_invites row with user_id instead of email).
--   * Ask to Join: a user asks a Stack that is open to requests; the owner or a co-captain
--     answers on the site (team_join_requests).
--
-- Stacks that existed before this start closed to requests, so none become public on their own.

-- Friend invites ------------------------------------------------------------------------------

alter table public.team_invites
  alter column email drop not null,
  add column user_id uuid references public.profiles (id) on delete cascade,
  add column declined_at timestamptz,
  add constraint team_invites_email_or_user check ((email is null) <> (user_id is null)),
  add constraint team_invites_team_user unique (team_id, user_id);

create index team_invites_user_id_idx on public.team_invites (user_id);

-- The invitee reads their own friend invites (for the Join or Decline prompt and its live updates).
create policy "Read invites sent to you" on public.team_invites
for select to authenticated using ((select auth.uid()) = user_id);

-- The join page only shows email invites; a friend invite's id is not a join link.
create or replace function public.get_team_invite(invite uuid)
returns table (team_name text, captain_name text, email text, accepted boolean, expired boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select t.name, p.display_name, i.email, i.accepted_at is not null, i.sent_at < now() - interval '7 days'
  from public.team_invites i
  join public.teams t on t.id = i.team_id
  join public.profiles p on p.id = t.owner_id
  where i.id = invite and i.email is not null
$$;

-- Email invites only, and only for the invited address.
create or replace function public.accept_team_invite(invite uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  found public.team_invites;
begin
  select * into found from public.team_invites where id = invite;
  if found.id is null or found.email is null then
    raise exception 'Invite not found' using errcode = 'P0002';
  end if;
  if found.email <> lower(coalesce((select auth.jwt() ->> 'email'), '')) then
    raise exception 'This invite is for %', found.email using errcode = '42501';
  end if;
  if found.accepted_at is null and found.sent_at < now() - interval '7 days' then
    raise exception 'This invite has expired. Ask your captain to send it again.' using errcode = '42501';
  end if;
  insert into public.team_members (team_id, user_id) values (found.team_id, (select auth.uid()))
  on conflict do nothing;
  update public.team_invites set accepted_at = coalesce(accepted_at, now()) where id = invite;
  return found.team_id;
end;
$$;

-- Invites an accepted friend to a Stack you own or co-captain. Inviting again re-opens a declined
-- invite after 7 days. At most 60 friend invites an hour.
create function public.invite_friend_to_team(team uuid, target uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  found public.team_invites;
begin
  if me is null or not public.runs_team(team) then
    raise exception 'Only the owner and co-captains invite to this stack' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and ((f.requester_id = me and f.addressee_id = target) or (f.addressee_id = me and f.requester_id = target))
  ) then
    raise exception 'You can invite friends only' using errcode = '42501';
  end if;
  if exists (select 1 from public.team_members m where m.team_id = team and m.user_id = target)
    or exists (select 1 from public.teams t where t.id = team and t.owner_id = target) then
    raise exception 'Already in this stack' using errcode = '23505';
  end if;
  if (select count(*) from public.team_invites i
      where i.sent_by = me and i.user_id is not null and i.sent_at > now() - interval '1 hour') >= 60 then
    raise exception 'Too many invites. Try again in a while.' using errcode = '54000';
  end if;

  select * into found from public.team_invites i where i.team_id = team and i.user_id = target;
  if found.id is null then
    insert into public.team_invites (team_id, user_id, sent_by) values (team, target, me) returning * into found;
  elsif found.declined_at is not null and found.declined_at > now() - interval '7 days' then
    raise exception 'They declined. You can invite them again 7 days later.' using errcode = '54000';
  elsif found.declined_at is not null or found.accepted_at is not null then
    update public.team_invites
    set declined_at = null, accepted_at = null, sent_at = now(), sent_by = me
    where id = found.id;
  end if;
  return found.id;
end;
$$;

-- Answers a friend invite sent to you. Only open invites can be answered.
create function public.answer_team_invite(invite uuid, accept boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  found public.team_invites;
begin
  select * into found from public.team_invites i where i.id = invite and i.user_id = me for update;
  if found.id is null then
    raise exception 'Invite not found' using errcode = 'P0002';
  end if;
  if found.accepted_at is not null or found.declined_at is not null then
    raise exception 'You already answered this invite' using errcode = '23505';
  end if;
  if accept then
    insert into public.team_members (team_id, user_id) values (found.team_id, me) on conflict do nothing;
    update public.team_invites set accepted_at = now() where id = invite;
  else
    update public.team_invites set declined_at = now() where id = invite;
  end if;
  return found.team_id;
end;
$$;

-- Open friend invites to you, newest first, with the Stack and who sent it.
create function public.my_team_invites()
returns table (invite_id uuid, team_id uuid, team_name text, inviter_name text, inviter_avatar_url text,
  members int, sent_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, t.id, t.name, p.display_name, p.avatar_url,
    (select count(*)::int from public.team_members m where m.team_id = t.id) + 1, i.sent_at
  from public.team_invites i
  join public.teams t on t.id = i.team_id
  left join public.profiles p on p.id = i.sent_by
  where i.user_id = (select auth.uid()) and i.accepted_at is null and i.declined_at is null
  order by i.sent_at desc
$$;

-- Ask to Join ---------------------------------------------------------------------------------

alter table public.teams add column open_to_requests boolean not null default true;
update public.teams set open_to_requests = false;

comment on column public.teams.open_to_requests is 'When true, the stack is listed and users can ask to join it.';

create table public.team_join_requests (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  answered_by uuid references public.profiles (id) on delete set null
);

create unique index team_join_requests_one_open on public.team_join_requests (team_id, user_id) where status = 'pending';
create index team_join_requests_user on public.team_join_requests (user_id, created_at);
create index team_join_requests_team on public.team_join_requests (team_id, status);

alter table public.team_join_requests enable row level security;
revoke insert, update, delete on public.team_join_requests from anon, authenticated;

create policy "Read requests to a stack you run, or your own" on public.team_join_requests
for select to authenticated using (public.runs_team(team_id) or (select auth.uid()) = user_id);

-- Asks to join an open Stack. One open request per Stack, 20 a day, and 7 days after a decline.
create function public.ask_to_join_team(team uuid)
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
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not exists (select 1 from public.teams t where t.id = team and t.open_to_requests) then
    raise exception 'This stack is not taking requests' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.team_members m where m.team_id = team and m.user_id = me)
    or exists (select 1 from public.teams t where t.id = team and t.owner_id = me) then
    raise exception 'Already in this stack' using errcode = '23505';
  end if;
  if exists (select 1 from public.team_join_requests r where r.team_id = team and r.user_id = me and r.status = 'pending') then
    raise exception 'You already asked. Wait for an answer.' using errcode = '23505';
  end if;
  if exists (
    select 1 from public.team_join_requests r
    where r.team_id = team and r.user_id = me and r.status = 'declined' and r.answered_at > now() - interval '7 days'
  ) then
    raise exception 'You can ask this stack again 7 days after it said no.' using errcode = '54000';
  end if;
  if (select count(*) from public.team_join_requests r where r.user_id = me and r.created_at > now() - interval '1 day') >= 20 then
    raise exception 'You can ask 20 stacks a day. Try again tomorrow.' using errcode = '54000';
  end if;
  insert into public.team_join_requests (team_id, user_id) values (team, me) returning id into new_id;
  return new_id;
end;
$$;

-- The owner or a co-captain answers an open request. Accepting adds the player.
create function public.answer_join_request(request uuid, accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  found public.team_join_requests;
begin
  select * into found from public.team_join_requests r where r.id = request for update;
  if found.id is null or not public.runs_team(found.team_id) then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  if found.status <> 'pending' then
    raise exception 'This request was already answered' using errcode = '23505';
  end if;
  if accept then
    insert into public.team_members (team_id, user_id) values (found.team_id, found.user_id) on conflict do nothing;
  end if;
  update public.team_join_requests
  set status = case when accept then 'accepted' else 'declined' end, answered_at = now(), answered_by = (select auth.uid())
  where id = request;
end;
$$;

-- The requester takes back their own open request.
create function public.cancel_join_request(request uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.team_join_requests
  set status = 'cancelled', answered_at = now()
  where id = request and user_id = (select auth.uid()) and status = 'pending';
  if not found then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
end;
$$;

-- Open requests to a Stack you run, oldest first, with the asker's name, avatar and rank.
create function public.team_join_requests_for(team uuid)
returns table (request_id uuid, user_id uuid, display_name text, avatar_url text, rank_tier smallint, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.user_id, p.display_name, p.avatar_url, p.rank_tier, r.created_at
  from public.team_join_requests r
  join public.profiles p on p.id = r.user_id
  where r.team_id = team and r.status = 'pending' and public.runs_team(team)
  order by r.created_at
$$;

revoke execute on function public.invite_friend_to_team, public.answer_team_invite, public.my_team_invites,
  public.ask_to_join_team, public.answer_join_request, public.cancel_join_request, public.team_join_requests_for
  from public, anon;
grant execute on function public.invite_friend_to_team, public.answer_team_invite, public.my_team_invites,
  public.ask_to_join_team, public.answer_join_request, public.cancel_join_request, public.team_join_requests_for
  to authenticated;

-- Live updates for the invite prompt and the requests tab.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.team_invites, public.team_join_requests;
  end if;
end;
$$;
