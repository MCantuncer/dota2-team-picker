-- Party seats: the party lives on Draft's Team Seats, one player per position.
--
-- 1. Every member of an open party has a position, and no two members share one. Old rows are
--    backfilled: closed parties lose their positions, open ones give a free position to members
--    on "any" or on a position someone who joined earlier already holds.
-- 2. A seat can hold a player who has not joined yet (party_seats): the leader seats them by
--    inviting them. They keep the seat when the invite pop-up runs out (15 minutes), so a friend
--    who plays without opening the site is still planned with their own heroes. Joining takes
--    the seat; declining, joining another party or the leader's x frees it. A player waits in at
--    most one seat across open parties.
-- 3. Taking a position another member holds swaps the two. The planner (Draft Captain, else the
--    leader) can move anyone, members and seated players alike.
-- 4. The whole party reads a seated player's heroes, rank and stats (Can, 2026-11-14), when that
--    player shares with whoever seated them (else the leader): a member of a Stack they run, or
--    an accepted friend with share_heroes_with_friends on.
--
-- Members and seated players never share a position; the functions below keep that under the
-- party's row lock, since one index cannot span the two tables.

-- 1. One position per member.
update public.party_members m set position = null
from public.parties p where p.id = m.party_id and p.closed_at is not null and m.position is not null;

do $$
declare
  r record;
  taken smallint[];
  last_party uuid;
begin
  for r in
    select m.party_id, m.user_id, m.position
    from public.party_members m join public.parties p on p.id = m.party_id
    where p.closed_at is null
    order by m.party_id, m.joined_at, m.user_id
  loop
    if last_party is distinct from r.party_id then
      taken := '{}';
      last_party := r.party_id;
    end if;
    if r.position is null or r.position = any (taken) then
      update public.party_members set position = (
        select min(n)::smallint from generate_series(1, 5) n where n <> all (taken)
      ) where party_id = r.party_id and user_id = r.user_id
      returning position into r.position;
    end if;
    taken := taken || r.position;
  end loop;
end;
$$;

alter table public.party_members
  add constraint party_members_one_per_position unique (party_id, position) deferrable initially deferred;

alter table public.party_members
  add column position_set_by uuid references public.profiles (id) on delete set null;
comment on column public.party_members.position_set_by is
  'Who last set this position: the member, the member they swapped with, or the planner.';

-- 2. Seated players who have not joined.
create table public.party_seats (
  party_id uuid not null references public.parties (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  position smallint not null check (position between 1 and 5),
  placed_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (party_id, user_id),
  constraint party_seats_one_per_position unique (party_id, position) deferrable initially deferred
);

create index party_seats_user_id_idx on public.party_seats (user_id);

alter table public.party_seats enable row level security;
revoke insert, update, delete on public.party_seats from anon, authenticated;

create policy "Read your party's seats and your own" on public.party_seats
for select to authenticated using (public.in_party(party_id) or (select auth.uid()) = user_id);

-- A player waits in at most one seat across open parties. (They may be a member of another party
-- meanwhile: joining this one takes them out of it, as invites always did.)
create function public.check_one_party_seat()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.party_seats s join public.parties p on p.id = s.party_id and p.closed_at is null
    where s.user_id = new.user_id and s.party_id <> new.party_id
  ) then
    raise exception 'That player has a seat in another party' using errcode = '23505';
  end if;
  return new;
end;
$$;

revoke execute on function public.check_one_party_seat from public, anon, authenticated;

create trigger party_seats_one_party before insert or update of user_id, party_id on public.party_seats
for each row execute function public.check_one_party_seat();

-- Invites run out after 15 minutes (the pop-up hides then); the seat does not. 'cancelled' is
-- the leader taking the seat back.
alter table public.party_invites add column expires_at timestamptz not null default now() + interval '15 minutes';
alter table public.party_invites drop constraint party_invites_status_check;
alter table public.party_invites add constraint party_invites_status_check
  check (status in ('pending', 'accepted', 'declined', 'cancelled'));

-- The lowest position no member and no seated player holds, or null when all five are taken.
create function public.first_free_position(party uuid)
returns smallint
language sql
stable
set search_path = ''
as $$
  select min(n)::smallint from generate_series(1, 5) n
  where not exists (select 1 from public.party_members m where m.party_id = party and m.position = n)
    and not exists (select 1 from public.party_seats s where s.party_id = party and s.position = n)
$$;

-- True when `player` shares their heroes, rank and stats with `viewer`: the player is in a Stack
-- the viewer runs, or they are accepted friends and the player shares with friends. The same rule
-- as lineup_players().
create function public.shares_with(viewer uuid, player uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select viewer = player
  or exists (
    select 1 from public.team_members m join public.teams t on t.id = m.team_id
    where m.user_id = player
      and (t.owner_id = viewer or exists (
        select 1 from public.team_members c where c.team_id = t.id and c.user_id = viewer and c.role = 'co_captain'))
  ) or exists (
    select 1 from public.friendships f join public.profiles pr on pr.id = player
    where f.status = 'accepted' and pr.share_heroes_with_friends
      and ((f.requester_id = viewer and f.addressee_id = player) or (f.addressee_id = viewer and f.requester_id = player))
  )
$$;

revoke execute on function public.first_free_position, public.shares_with from public, anon, authenticated;

-- Starts a party with the signed-in user as leader, in `seat` (Carry when not given). Returns its id.
drop function public.start_party(uuid);
create function public.start_party(team uuid default null, seat smallint default null)
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
  values (new_id, me, coalesce(seat, 1), me);
  return new_id;
end;
$$;

-- Seats a friend or teammate in the leader's party and pops the invite up on their screen.
-- `seat` moves them there (it must be empty or already theirs); without it they keep their seat or
-- take the first free one. Inviting again re-sends the pop-up. Members plus seated players stay at 5.
drop function public.invite_to_party(uuid);
create function public.invite_to_party(target uuid, seat smallint default null)
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
    want := coalesce(want, public.first_free_position(party));
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

-- Frees a seat (the leader's x on a seated player) and closes their invite.
create function public.unseat_player(target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  party uuid;
begin
  select id into party from public.parties where leader_id = (select auth.uid()) and closed_at is null for update;
  if party is null then
    raise exception 'Only the party leader can do that' using errcode = '42501';
  end if;
  delete from public.party_seats where party_id = party and user_id = target;
  update public.party_invites set status = 'cancelled'
  where party_id = party and user_id = target and status = 'pending';
end;
$$;

-- Accepts or declines an invite. Accepting joins the party in the player's seat (or the first free
-- one) and leaves any other party. A seated player can still accept after the pop-up ran out.
-- Declining frees the seat.
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
    want := coalesce(want, public.first_free_position(party));
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

-- Joins the party behind an invite link. A seated player takes their seat; anyone else the first
-- seat nobody holds. Returns the party's id.
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
  want := coalesce(want, public.first_free_position(party));
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

-- Moves `target` (a member or a seated player) to `want` in `party`, swapping with whoever holds
-- it. The caller has locked the party and checked who may do this. Internal.
create function public.move_in_party(party uuid, target uuid, want smallint, actor uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  was smallint;
  other_member uuid;
  other_seat uuid;
begin
  if want is null or want not between 1 and 5 then
    raise exception 'Pick a position' using errcode = '22023';
  end if;
  select position into was from public.party_members where party_id = party and user_id = target;
  if not found then
    select position into was from public.party_seats where party_id = party and user_id = target;
    if not found then
      raise exception 'That player is not in your party' using errcode = 'P0002';
    end if;
  end if;
  if was = want then
    return;
  end if;
  select user_id into other_member from public.party_members where party_id = party and position = want;
  select user_id into other_seat from public.party_seats where party_id = party and position = want;
  -- Both unique constraints are deferred, so the swap is checked once, at the end.
  update public.party_members set position = was, position_set_by = actor
  where party_id = party and user_id = other_member;
  update public.party_seats set position = was where party_id = party and user_id = other_seat;
  update public.party_members set position = want, position_set_by = actor where party_id = party and user_id = target;
  update public.party_seats set position = want where party_id = party and user_id = target;
end;
$$;

revoke execute on function public.move_in_party from public, anon, authenticated;

-- Sets the signed-in user's position this game, swapping with the member who holds it. A seat
-- held for a player who hasn't joined can't be taken (the leader can free it).
create or replace function public.set_party_position(want smallint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  party uuid := public.my_party();
  holder text;
begin
  if party is null then
    raise exception 'You are not in a party' using errcode = 'P0002';
  end if;
  if want is null or want not between 1 and 5 then
    raise exception 'Pick a position' using errcode = '22023';
  end if;
  perform 1 from public.parties where id = party for update;
  select coalesce(pr.display_name, 'a player') into holder from public.party_seats s
  join public.profiles pr on pr.id = s.user_id where s.party_id = party and s.position = want;
  if holder is not null then
    raise exception 'That seat is waiting for %', holder using errcode = '23505';
  end if;
  perform public.move_in_party(party, me, want, me);
end;
$$;

-- The planner (Draft Captain, else the leader) moves a member or a seated player.
create function public.set_member_position(target uuid, want smallint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  party uuid := public.my_party();
begin
  if party is null or not exists (
    select 1 from public.parties p where p.id = party and coalesce(p.captain_id, p.leader_id) = me
  ) then
    raise exception 'Only the Draft Captain, or the leader without one, can move players' using errcode = '42501';
  end if;
  perform 1 from public.parties where id = party for update;
  perform public.move_in_party(party, target, want, me);
end;
$$;

-- Takes the signed-in user out of their open party, as before; when the party closes, its seats go.
create or replace function public.leave_party()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  party uuid := public.my_party();
  open_draft uuid;
  next_leader uuid;
begin
  if party is null then
    return;
  end if;
  perform 1 from public.parties where id = party for update;
  if not exists (select 1 from public.party_members where party_id = party and user_id <> me) then
    update public.party_drafts set ended_at = now() where party_id = party and ended_at is null
    returning id into open_draft;
    if open_draft is not null then
      perform public.record_draft_players(open_draft);
    end if;
  end if;
  delete from public.party_members where party_id = party and user_id = me;
  select user_id into next_leader from public.party_members where party_id = party order by joined_at limit 1;
  if next_leader is null then
    update public.parties set closed_at = now() where id = party;
    delete from public.party_seats where party_id = party;
  else
    update public.parties set leader_id = next_leader where id = party and leader_id = me;
  end if;
end;
$$;

-- The lobby, now with who last set each position.
drop function public.party_view();
create function public.party_view()
returns table (
  party_id uuid,
  leader_id uuid,
  team_id uuid,
  user_id uuid,
  display_name text,
  avatar_url text,
  "position" smallint,
  joined_at timestamptz,
  captain_id uuid,
  captain_online boolean,
  captain_request_by uuid,
  captain_request_expires_at timestamptz,
  captain_asked_at timestamptz,
  server_now timestamptz,
  position_set_by uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.leader_id, p.team_id, m.user_id, pr.display_name, pr.avatar_url, m.position, m.joined_at,
    p.captain_id, p.captain_id is not null and public.captain_online(p.id),
    case when p.captain_request_at > now() - public.captain_timing('request') then p.captain_request_by end,
    case when p.captain_request_at > now() - public.captain_timing('request')
      then p.captain_request_at + public.captain_timing('request') end,
    m.captain_asked_at, now(), m.position_set_by
  from public.parties p
  join public.party_members m on m.party_id = p.id
  join public.profiles pr on pr.id = m.user_id
  where p.id = public.my_party()
  order by m.user_id <> p.leader_id, m.joined_at
$$;

-- The seated players of the signed-in user's party, with whether their invite pop-up is still live.
create function public.party_seats_view()
returns table (
  user_id uuid,
  display_name text,
  avatar_url text,
  "position" smallint,
  placed_by uuid,
  invite_live boolean,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.user_id, pr.display_name, pr.avatar_url, s.position, s.placed_by,
    exists (select 1 from public.party_invites i where i.party_id = s.party_id and i.user_id = s.user_id
      and i.status = 'pending' and i.expires_at > now()),
    s.created_at
  from public.party_seats s
  join public.parties p on p.id = s.party_id and p.closed_at is null
  join public.profiles pr on pr.id = s.user_id
  where s.party_id = public.my_party()
  order by s.position
$$;

-- Open invites to the signed-in user: live ones, and older ones that still hold their seat (the
-- late Join card). `position` is the seat waiting for them.
drop function public.my_party_invites();
create function public.my_party_invites()
returns table (
  party_id uuid,
  invited_by uuid,
  inviter_name text,
  inviter_avatar_url text,
  members int,
  created_at timestamptz,
  "position" smallint,
  expires_at timestamptz,
  seated boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.party_id, i.invited_by, pr.display_name, pr.avatar_url,
    (select count(*)::int from public.party_members m where m.party_id = i.party_id), i.created_at,
    s.position, i.expires_at, s.user_id is not null
  from public.party_invites i
  join public.parties p on p.id = i.party_id and p.closed_at is null
  join public.profiles pr on pr.id = i.invited_by
  left join public.party_seats s on s.party_id = i.party_id and s.user_id = i.user_id
  where i.user_id = (select auth.uid()) and i.status = 'pending'
    and (i.expires_at > now() or s.user_id is not null)
    and i.party_id is distinct from public.my_party()
  order by i.created_at desc
$$;

-- Every player's heroes, rank and stats for the Draft Room: members, and seated players who share
-- with whoever seated them (the leader when that player has left the party).
drop function public.party_player_stats();
create function public.party_player_stats()
returns table (
  user_id uuid,
  display_name text,
  rank_tier smallint,
  positions smallint[],
  favorites jsonb,
  hero_stats jsonb,
  top jsonb,
  seated boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with party as (
    select p.id, p.leader_id from public.parties p where p.id = public.my_party() and p.closed_at is null
  ),
  players as (
    select m.user_id, false as seated, 0 as sort, m.user_id <> party.leader_id as not_leader, m.joined_at as since
    from public.party_members m join party on party.id = m.party_id
    union all
    select s.user_id, true, 1, true, s.created_at
    from public.party_seats s join party on party.id = s.party_id
    where public.shares_with(
      case when exists (select 1 from public.party_members pm where pm.party_id = s.party_id and pm.user_id = s.placed_by)
        then s.placed_by else party.leader_id end,
      s.user_id)
  )
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
    public.top_by_position(x.user_id),
    x.seated
  from players x
  join public.profiles pr on pr.id = x.user_id
  order by x.sort, x.not_leader, x.since
$$;

-- The planner's hero pool, now also with the seated players the party may plan with.
create or replace function public.party_hero_pool()
returns table (user_id uuid, "position" smallint, hero_id smallint)
language sql
stable
security definer
set search_path = ''
as $$
  with party as (
    select p.id, p.leader_id from public.parties p
    where p.id = public.my_party() and coalesce(p.captain_id, p.leader_id) = (select auth.uid()) and p.closed_at is null
  ),
  players as (
    select m.user_id from public.party_members m join party on party.id = m.party_id
    union all
    select s.user_id from public.party_seats s join party on party.id = s.party_id
    where public.shares_with(
      case when exists (select 1 from public.party_members pm where pm.party_id = s.party_id and pm.user_id = s.placed_by)
        then s.placed_by else party.leader_id end,
      s.user_id)
  )
  select f.user_id, f.position, f.hero_id
  from players x join public.favorite_heroes f on f.user_id = x.user_id
  order by f.user_id, f.position, f.created_at
$$;

revoke execute on function public.start_party, public.invite_to_party, public.unseat_player, public.set_member_position,
  public.party_view, public.party_seats_view, public.my_party_invites, public.party_player_stats from public, anon;
grant execute on function public.start_party, public.invite_to_party, public.unseat_player, public.set_member_position,
  public.party_view, public.party_seats_view, public.my_party_invites, public.party_player_stats to authenticated;

-- Live updates for the seats.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.party_seats;
  end if;
end;
$$;
