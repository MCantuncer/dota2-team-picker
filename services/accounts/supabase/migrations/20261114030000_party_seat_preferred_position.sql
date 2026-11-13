-- A player gets a seat at a position they play. Starting a party seated the leader in Carry, and
-- an invite or a join without a seat took the lowest free position, so a Mid player could land in
-- Carry with no heroes for it. Now the leader starts in their first position from My Heroes, and
-- anyone else takes the first free one of their positions before any other free one.

-- The lowest free position `player` plays (favorite_positions), else the lowest free one; null when
-- all five are taken.
create function public.first_free_position(party uuid, player uuid)
returns smallint
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select min(f.position) from public.favorite_positions f
     where f.user_id = player
       and not exists (select 1 from public.party_members m where m.party_id = party and m.position = f.position)
       and not exists (select 1 from public.party_seats s where s.party_id = party and s.position = f.position)),
    public.first_free_position(party)
  )
$$;

revoke execute on function public.first_free_position(uuid, uuid) from public, anon, authenticated;

-- Starts a party with the signed-in user as leader, in `seat`, else their first position, else Carry.
create or replace function public.start_party(team uuid default null, seat smallint default null)
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
  if seat is not null and seat not between 1 and 5 then
    raise exception 'Pick a position' using errcode = '22023';
  end if;
  if team is not null and not (public.owns_team(team) or public.is_team_member(team)) then
    raise exception 'Team not found' using errcode = 'P0002';
  end if;
  perform public.leave_party();
  -- A seat waiting for the starter elsewhere goes: they lead their own party now.
  delete from public.party_seats where user_id = me;
  insert into public.parties (leader_id, team_id) values (me, team) returning id into new_id;
  insert into public.party_members (party_id, user_id, position, position_set_by)
  values (new_id, me, coalesce(seat, (select min(f.position) from public.favorite_positions f where f.user_id = me), 1), me);
  return new_id;
end;
$$;

-- As before; without a seat the player takes the first free one of their positions.
create or replace function public.invite_to_party(target uuid, seat smallint default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  party uuid;
  holder text;
  want smallint := seat;
begin
  select id into party from public.parties where leader_id = me and closed_at is null for update;
  if party is null then
    raise exception 'Start a party first' using errcode = 'P0002';
  end if;
  if target = me or not public.can_invite(target) then
    raise exception 'You can invite friends and teammates only' using errcode = '42501';
  end if;
  if want is not null and want not between 1 and 5 then
    raise exception 'Pick a position' using errcode = '22023';
  end if;
  if exists (select 1 from public.party_members where party_id = party and user_id = target) then
    return;
  end if;
  if (select count(*) from public.party_invites where invited_by = me and created_at > now() - interval '1 hour') >= 60 then
    raise exception 'Too many invites. Try again in a while.' using errcode = '54000';
  end if;

  if want is not null then
    select coalesce(pr.display_name, 'Someone') into holder from public.party_members m
    join public.profiles pr on pr.id = m.user_id where m.party_id = party and m.position = want;
    if holder is null then
      select coalesce(pr.display_name, 'Someone') into holder from public.party_seats s
      join public.profiles pr on pr.id = s.user_id where s.party_id = party and s.position = want and s.user_id <> target;
    end if;
    if holder is not null then
      raise exception '% is in that seat', holder using errcode = '23505';
    end if;
  else
    select s.position into want from public.party_seats s where s.party_id = party and s.user_id = target;
    want := coalesce(want, public.first_free_position(party, target));
    if want is null then
      raise exception 'The party is full' using errcode = '54000';
    end if;
  end if;

  insert into public.party_seats (party_id, user_id, position, placed_by) values (party, target, want, me)
  on conflict (party_id, user_id) do update set position = excluded.position, placed_by = excluded.placed_by;

  delete from public.party_invites where party_id = party and user_id = target;
  insert into public.party_invites (party_id, user_id, invited_by) values (party, target, me);
end;
$$;

-- As before; joining without a seat takes the first free one of the player's positions.
create or replace function public.answer_party_invite(party uuid, accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  want smallint;
begin
  if not exists (
    select 1 from public.party_invites i join public.parties p on p.id = i.party_id
    where i.party_id = party and i.user_id = me and i.status = 'pending' and p.closed_at is null
      and (i.expires_at > now() or exists (select 1 from public.party_seats s where s.party_id = party and s.user_id = me))
  ) then
    raise exception 'This invite is no longer open' using errcode = 'P0002';
  end if;
  -- Locks the party so two players can't both take the last seat.
  perform 1 from public.parties where id = party for update;
  if not accept then
    delete from public.party_seats where party_id = party and user_id = me;
    update public.party_invites set status = 'declined' where party_id = party and user_id = me;
    return;
  end if;
  if party is distinct from public.my_party() then
    delete from public.party_seats where party_id = party and user_id = me returning position into want;
    want := coalesce(want, public.first_free_position(party, me));
    if want is null then
      raise exception 'The party is full' using errcode = '54000';
    end if;
    perform public.leave_party();
    delete from public.party_seats where user_id = me;
    insert into public.party_members (party_id, user_id, position, position_set_by) values (party, me, want, me);
  end if;
  update public.party_invites set status = 'accepted' where party_id = party and user_id = me;
end;
$$;

create or replace function public.join_party_by_link(code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  party uuid;
  want smallint;
begin
  if me is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  select l.party_id into party from public.party_links l where l.code = join_party_by_link.code;
  if party is not null then
    -- The party can only be locked once the code has named it, so the code is
    -- checked again under the lock: a link the leader just replaced must fail.
    -- Leaving the old party below locks it second, the same order as
    -- answer_party_invite.
    perform 1 from public.parties p where p.id = party for update;
    perform 1 from public.party_links l
    join public.parties p on p.id = l.party_id and p.closed_at is null
    where l.party_id = party and l.code = join_party_by_link.code and l.expires_at > now();
  end if;
  if party is null or not found then
    raise exception 'This invite link no longer works' using errcode = 'P0002';
  end if;

  if party = public.my_party() then
    return party;
  end if;
  if exists (select 1 from public.party_kicks k where k.party_id = party and k.user_id = me) then
    raise exception 'The leader removed you from this party' using errcode = '42501';
  end if;
  select s.position into want from public.party_seats s where s.party_id = party and s.user_id = me;
  want := coalesce(want, public.first_free_position(party, me));
  if want is null then
    raise exception 'Every seat is taken' using errcode = '54000';
  end if;

  perform public.leave_party();
  -- Joining frees any seat waiting for them, here or in another party.
  delete from public.party_seats where user_id = me;
  insert into public.party_members (party_id, user_id, position, position_set_by) values (party, me, want, me);
  -- An invite to the same party no longer needs to pop up.
  update public.party_invites i set status = 'accepted'
  where i.party_id = party and i.user_id = me and i.status = 'pending';
  return party;
end;
$$;
