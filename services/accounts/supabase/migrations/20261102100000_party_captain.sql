-- Draft captain for a party, like Captain's Mode in Dota. One player in the party is the
-- draft captain: they run the draft for everyone and plan all five heroes. Anyone else in the
-- party can press Become captain:
--
-- - nobody is captain, the caller leads the party, or the captain has had no page of the site
--   open for 2 minutes: they get it at once;
-- - otherwise a request goes to the captain, who answers Yes or No. No answer within 30 seconds
--   keeps the current captain, and the same player can ask again a minute after asking.
--
-- The captain's open page calls captain_heartbeat() every 20 seconds. Those pings go to their
-- own table, outside the realtime publication, so they don't wake every lobby.
--
-- Captain is separate from the party leader (who started the party and sends invites). This
-- migration only adds the role and the handoff. Locking the draft to the captain comes later.

alter table public.parties
  add column captain_id uuid references public.profiles (id) on delete set null,
  add column captain_request_by uuid references public.profiles (id) on delete set null,
  add column captain_request_at timestamptz;

comment on column public.parties.captain_id is 'The draft captain, or null when anyone in the party can run the draft.';
comment on column public.parties.captain_request_by is 'Who asked the captain for the role. Open while captain_request_at is under 30 seconds old.';

-- When each player last asked for captain, so a No can't be answered by asking again at once.
alter table public.party_members add column captain_asked_at timestamptz;

-- When the captain last had a page of the site open. Only the functions below use it.
create table public.party_captain_seen (
  party_id uuid primary key references public.parties (id) on delete cascade,
  seen_at timestamptz not null default now()
);

alter table public.party_captain_seen enable row level security;
revoke all on public.party_captain_seen from anon, authenticated;

-- How long a request stays open, how long a late answer still counts, how soon the same player
-- can ask again, and how long after their last ping the captain counts as gone.
create function public.captain_timing(what text)
returns interval
language sql
immutable
set search_path = ''
as $$
  select case what
    when 'request' then interval '30 seconds'
    when 'grace' then interval '35 seconds'
    when 'cooldown' then interval '60 seconds'
    when 'offline' then interval '2 minutes'
  end
$$;

-- True when the party's captain had a page of the site open in the last 2 minutes.
create function public.captain_online(party uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.party_captain_seen s
    where s.party_id = party and s.seen_at > now() - public.captain_timing('offline')
  )
$$;

-- Makes `who` the captain of `party`, clears any request and starts their presence afresh, so
-- the next player can't take over straight away on the old captain's last ping.
create function public.set_party_captain(party uuid, who uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.parties set captain_id = who, captain_request_by = null, captain_request_at = null where id = party;
  if who is not null then
    insert into public.party_captain_seen (party_id, seen_at) values (party, now())
    on conflict (party_id) do update set seen_at = now();
  end if;
end;
$$;

-- The signed-in user's open party, locked, after checking they are still in it. The check runs
-- after the lock, so someone leaving at the same moment can't end up captain.
create function public.lock_my_party()
returns public.parties
language plpgsql
security definer
set search_path = ''
as $$
declare
  party uuid := public.my_party();
  locked public.parties;
begin
  if party is null then
    raise exception 'Join a party first' using errcode = 'P0002';
  end if;
  select * into locked from public.parties where id = party and closed_at is null for update;
  if not found or not exists (
    select 1 from public.party_members m where m.party_id = party and m.user_id = (select auth.uid())
  ) then
    raise exception 'Join a party first' using errcode = 'P0002';
  end if;
  return locked;
end;
$$;

-- Become captain, or ask the captain for it. Returns 'captain' or 'requested'.
create function public.become_captain()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  p public.parties := public.lock_my_party();
  asked timestamptz;
begin
  if p.captain_id = me then
    return 'captain';
  end if;
  if p.captain_id is null or p.leader_id = me or not public.captain_online(p.id) then
    perform public.set_party_captain(p.id, me);
    return 'captain';
  end if;
  if p.captain_request_at > now() - public.captain_timing('request') then
    if p.captain_request_by = me then
      return 'requested';
    end if;
    raise exception 'Someone else asked first. Try again in a moment.' using errcode = '55000';
  end if;
  select m.captain_asked_at into asked from public.party_members m where m.party_id = p.id and m.user_id = me;
  if asked > now() - public.captain_timing('cooldown') then
    raise exception 'Wait a moment before asking again' using errcode = '54000';
  end if;
  update public.parties set captain_request_by = me, captain_request_at = now() where id = p.id;
  update public.party_members set captain_asked_at = now() where party_id = p.id and user_id = me;
  return 'requested';
end;
$$;

-- The captain answers the open request. Yes hands the role over.
create function public.answer_captain_request(accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.parties := public.lock_my_party();
begin
  if p.captain_id is distinct from (select auth.uid()) then
    raise exception 'Only the draft captain can answer' using errcode = '42501';
  end if;
  if p.captain_request_by is null or p.captain_request_at <= now() - public.captain_timing('grace') then
    raise exception 'Too late, the request ran out' using errcode = 'P0002';
  end if;
  if accept then
    perform public.set_party_captain(p.id, p.captain_request_by);
  else
    update public.parties set captain_request_by = null, captain_request_at = null where id = p.id;
  end if;
end;
$$;

-- The captain gives up the role; anyone in the party can run the draft again.
create function public.step_down_captain()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.parties := public.lock_my_party();
begin
  if p.captain_id = (select auth.uid()) then
    update public.parties set captain_id = null, captain_request_by = null, captain_request_at = null where id = p.id;
  end if;
end;
$$;

-- The captain's open page says it is still there. Does nothing for anyone else.
create function public.captain_heartbeat()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  party uuid := public.my_party();
begin
  if exists (select 1 from public.parties p where p.id = party and p.captain_id = (select auth.uid())) then
    insert into public.party_captain_seen (party_id, seen_at) values (party, now())
    on conflict (party_id) do update set seen_at = now();
  end if;
end;
$$;

-- A player leaving or removed stops being captain, and their open request goes. The party row
-- is locked first, so a Yes or a Become captain running at the same moment finishes before this
-- runs, or sees the player gone.
create function public.clear_captain_of_leaver()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.parties where id = old.party_id for update;
  update public.parties set
    captain_id = case when captain_id = old.user_id then null else captain_id end,
    captain_request_by = case when captain_request_by = old.user_id or captain_id = old.user_id then null else captain_request_by end,
    captain_request_at = case when captain_request_by = old.user_id or captain_id = old.user_id then null else captain_request_at end
  where id = old.party_id and (captain_id = old.user_id or captain_request_by = old.user_id);
  return old;
end;
$$;

create trigger party_members_clear_captain
after delete on public.party_members
for each row execute function public.clear_captain_of_leaver();

-- The lobby, now with the draft captain, an open request and the server's clock, so every
-- screen counts the request down from the same time.
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
  server_now timestamptz
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
    m.captain_asked_at, now()
  from public.parties p
  join public.party_members m on m.party_id = p.id
  join public.profiles pr on pr.id = m.user_id
  where p.id = public.my_party()
  order by m.user_id <> p.leader_id, m.joined_at
$$;

revoke execute on function public.captain_timing, public.captain_online, public.set_party_captain,
  public.lock_my_party, public.clear_captain_of_leaver from public, anon, authenticated;
revoke execute on function public.become_captain, public.answer_captain_request, public.step_down_captain,
  public.captain_heartbeat, public.party_view from public, anon;
grant execute on function public.become_captain, public.answer_captain_request, public.step_down_captain,
  public.captain_heartbeat, public.party_view to authenticated;
