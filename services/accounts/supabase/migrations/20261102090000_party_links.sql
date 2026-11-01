-- Party invite links. The party leader copies one link and pastes it in
-- Discord or Steam chat; anyone signed in who opens it can join, even if they
-- aren't a friend or teammate. A link works for 24 hours after the leader last
-- asked for it, only while the party is open, and stops at once when the
-- leader makes a new one.
--
-- The code is a secret, so both tables below are closed to users (row level
-- security on, no policies) and kept out of the realtime publication. Everything
-- goes through the functions at the bottom.

create table public.party_links (
  party_id uuid primary key references public.parties (id) on delete cascade,
  -- 64 random bits, so codes can't be guessed.
  code text not null unique,
  expires_at timestamptz not null
);

comment on table public.party_links is 'The secret code of each party''s invite link. Read only through party_link().';

-- Players the leader removed. They can't come back by link (a direct invite still works).
create table public.party_kicks (
  party_id uuid not null references public.parties (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  primary key (party_id, user_id)
);

alter table public.party_links enable row level security;
alter table public.party_kicks enable row level security;
revoke all on public.party_links, public.party_kicks from anon, authenticated;

-- Records a removal. Only the leader of the open party removing someone else
-- counts; leaving on your own, and cascades from deleted parties or profiles,
-- write nothing.
create function public.record_party_kick()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.user_id is distinct from (select auth.uid()) and exists (
    select 1 from public.parties p
    where p.id = old.party_id and p.leader_id = (select auth.uid()) and p.closed_at is null
  ) then
    insert into public.party_kicks (party_id, user_id) values (old.party_id, old.user_id) on conflict do nothing;
  end if;
  return null;
end;
$$;

create trigger party_members_record_kick
after delete on public.party_members
for each row execute function public.record_party_kick();

-- A player back in the party (by a direct invite) is no longer blocked from the link.
create function public.clear_party_kick()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.party_kicks where party_id = new.party_id and user_id = new.user_id;
  return null;
end;
$$;

create trigger party_members_clear_kick
after insert on public.party_members
for each row execute function public.clear_party_kick();

-- The invite link of the signed-in user's party (the leader only). Makes one
-- when there is none or it expired, and a new one when fresh is true (the old
-- one stops working). Every call keeps the link alive for another 24 hours.
create function public.party_link(fresh boolean default false)
returns table (code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  party uuid := public.my_party();
begin
  if party is null then
    raise exception 'Start a party first' using errcode = 'P0002';
  end if;
  -- Locked so a reset and a join, or two first clicks, can't interleave.
  perform 1 from public.parties p where p.id = party and p.leader_id = me and p.closed_at is null for update;
  if not found then
    raise exception 'Only the party leader can share the invite link' using errcode = '42501';
  end if;

  return query
  insert into public.party_links as l (party_id, code, expires_at)
  values (party, encode(extensions.gen_random_bytes(8), 'hex'), now() + interval '24 hours')
  on conflict (party_id) do update set
    code = case when fresh or l.expires_at <= now() then excluded.code else l.code end,
    expires_at = excluded.expires_at
  returning l.code, l.expires_at;
end;
$$;

-- What the invite page shows. Empty when the link is unknown, expired or the party closed.
create function public.party_by_link(code text)
returns table (
  party_id uuid,
  leader_id uuid,
  leader_name text,
  leader_avatar_url text,
  members int,
  is_member boolean,
  is_kicked boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.leader_id, pr.display_name, pr.avatar_url,
    (select count(*)::int from public.party_members m where m.party_id = p.id),
    public.in_party(p.id),
    exists (select 1 from public.party_kicks k where k.party_id = p.id and k.user_id = (select auth.uid()))
  from public.party_links l
  join public.parties p on p.id = l.party_id and p.closed_at is null
  join public.profiles pr on pr.id = p.leader_id
  where l.code = party_by_link.code and l.expires_at > now() and (select auth.uid()) is not null
$$;

-- Joins the party behind an invite link (5 players at most) and leaves any
-- other one. Returns the party's id.
create function public.join_party_by_link(code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  party uuid;
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
  if (select count(*) from public.party_members m where m.party_id = party) >= 5 then
    raise exception 'The party is full' using errcode = '54000';
  end if;

  perform public.leave_party();
  insert into public.party_members (party_id, user_id) values (party, me);
  -- An invite to the same party no longer needs to pop up.
  update public.party_invites i set status = 'accepted'
  where i.party_id = party and i.user_id = me and i.status = 'pending';
  return party;
end;
$$;

revoke execute on function public.record_party_kick, public.clear_party_kick from public, anon, authenticated;
revoke execute on function public.party_link, public.party_by_link, public.join_party_by_link from public, anon;
grant execute on function public.party_link, public.party_by_link, public.join_party_by_link to authenticated;
