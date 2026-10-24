-- Friends. Players add each other on the site, then invite friends to a
-- party (a later migration). Nothing here talks to Steam.
--
-- A request is one row from the requester to the addressee. It starts
-- pending and becomes accepted when the addressee accepts it (or sends one
-- back). Declining, cancelling and unfriending all delete the row. Requests
-- are made through the functions below, never by writing the table.
--
-- People find each other by a personal "add me" link (profiles.friend_code)
-- or among the members of their teams.

-- 48 random bits; enough that codes can't be guessed.
alter table public.profiles
  add column friend_code text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);

comment on column public.profiles.friend_code is 'Secret part of the user''s "add me as a friend" link.';

create table public.friendships (
  requester_id uuid not null references public.profiles (id) on delete cascade,
  addressee_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (requester_id, addressee_id),
  check (requester_id <> addressee_id)
);

-- One row per pair, whoever asked first.
create unique index friendships_pair_idx
  on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index friendships_addressee_id_idx on public.friendships (addressee_id);

alter table public.friendships enable row level security;
revoke insert, update on public.friendships from anon, authenticated;

create policy "Read own friendships" on public.friendships
for select to authenticated using ((select auth.uid()) in (requester_id, addressee_id));

-- Decline, cancel or unfriend.
create policy "Remove own friendships" on public.friendships
for delete to authenticated using ((select auth.uid()) in (requester_id, addressee_id));

-- What the "add me" page shows: whose link it is.
create function public.profile_by_friend_code(code text)
returns table (id uuid, display_name text, avatar_url text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.display_name, p.avatar_url from public.profiles p where p.friend_code = code
$$;

-- Sends a friend request, or accepts theirs if they already asked. Returns the friendship's status.
create function public.send_friend_request(target uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  found public.friendships;
begin
  if me is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if target = me then
    raise exception 'You can''t add yourself' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = target) then
    raise exception 'Player not found' using errcode = 'P0002';
  end if;

  select * into found from public.friendships
  where (requester_id = me and addressee_id = target) or (requester_id = target and addressee_id = me);
  if found.requester_id = target and found.status = 'pending' then
    update public.friendships set status = 'accepted', accepted_at = now()
    where requester_id = target and addressee_id = me;
    return 'accepted';
  end if;
  if found.requester_id is not null then
    return found.status;
  end if;

  -- Keep the button from being used to spam people.
  if (select count(*) from public.friendships
      where requester_id = me and created_at > now() - interval '1 day') >= 50 then
    raise exception 'You can send 50 friend requests a day. Try again tomorrow.' using errcode = '54000';
  end if;

  insert into public.friendships (requester_id, addressee_id) values (me, target);
  return 'pending';
end;
$$;

-- Accepts a pending request someone sent to the signed-in user.
create function public.accept_friend_request(requester uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.friendships set status = 'accepted', accepted_at = now()
  where requester_id = requester and addressee_id = (select auth.uid()) and status = 'pending';
  if not found then
    raise exception 'Friend request not found' using errcode = 'P0002';
  end if;
end;
$$;

-- The signed-in user's friends and pending requests, with just what the friends page shows.
create function public.my_friends()
returns table (
  user_id uuid,
  display_name text,
  avatar_url text,
  steam_linked boolean,
  status text,
  incoming boolean,
  since timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.display_name, p.avatar_url, p.steam_id is not null, f.status,
    f.addressee_id = (select auth.uid()), coalesce(f.accepted_at, f.created_at)
  from public.friendships f
  join public.profiles p
    on p.id = case when f.requester_id = (select auth.uid()) then f.addressee_id else f.requester_id end
  where (select auth.uid()) in (f.requester_id, f.addressee_id)
  order by p.display_name
$$;

-- People from the user's teams who aren't friends yet and have no pending request either way.
create function public.friend_suggestions()
returns table (user_id uuid, display_name text, avatar_url text, team_name text)
language sql
stable
security definer
set search_path = ''
as $$
  with my_teams as (
    select t.id, t.name from public.teams t where t.owner_id = (select auth.uid())
    union
    select t.id, t.name from public.teams t
    join public.team_members m on m.team_id = t.id and m.user_id = (select auth.uid())
  ),
  people as (
    select m.user_id, mt.name as team_name from public.team_members m join my_teams mt on mt.id = m.team_id
    union all
    select t.owner_id, mt.name from public.teams t join my_teams mt on mt.id = t.id
  )
  select distinct on (p.id) p.id, p.display_name, p.avatar_url, pe.team_name
  from people pe
  join public.profiles p on p.id = pe.user_id
  where p.id <> (select auth.uid())
    and not exists (
      select 1 from public.friendships f
      where (f.requester_id = p.id and f.addressee_id = (select auth.uid()))
         or (f.requester_id = (select auth.uid()) and f.addressee_id = p.id)
    )
  order by p.id, pe.team_name
$$;

revoke execute on function public.profile_by_friend_code, public.send_friend_request, public.accept_friend_request,
  public.my_friends, public.friend_suggestions from public, anon;
grant execute on function public.profile_by_friend_code, public.send_friend_request, public.accept_friend_request,
  public.my_friends, public.friend_suggestions to authenticated;
