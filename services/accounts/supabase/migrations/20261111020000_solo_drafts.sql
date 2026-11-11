-- Phone Follows Your PC. A signed-in player's solo draft lives on the server, the same way party drafts do, so the
-- phone they follow on sees what Watch Dota reads on their PC within a second or two. Each entry is a row in an
-- action log; every device replays it in id order, so two devices editing at once end up with the same board.
-- Party drafts are not touched.

create table public.solo_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  side text check (side in ('radiant', 'dire')),
  -- When the PC last read the Dota window; null once it stops.
  watching_at timestamptz,
  -- When a following phone was last open.
  phone_seen_at timestamptz
);

-- One open draft per player at a time.
create unique index solo_drafts_open_idx on public.solo_drafts (user_id) where ended_at is null;

create table public.solo_draft_actions (
  id bigint generated always as identity primary key,
  draft_id uuid not null references public.solo_drafts (id) on delete cascade,
  -- ally / enemy: a pick for that team. ban: a banned hero. remove: takes the hero back out.
  kind text not null check (kind in ('ally', 'enemy', 'ban', 'remove')),
  hero_id smallint not null check (hero_id > 0),
  position smallint check (position between 1 and 5),
  -- A random id of the browser tab that made the entry, so Undo takes back only that tab's own entries.
  device text not null check (char_length(device) between 1 and 64),
  created_at timestamptz not null default now(),
  check (position is null or kind in ('ally', 'enemy'))
);

create index solo_draft_actions_draft_id_idx on public.solo_draft_actions (draft_id, id);

alter table public.solo_drafts enable row level security;
alter table public.solo_draft_actions enable row level security;
revoke insert, update, delete on public.solo_drafts, public.solo_draft_actions from anon, authenticated;

create policy "Read your own solo drafts" on public.solo_drafts
for select to authenticated using (user_id = (select auth.uid()));

create policy "Read the actions of your own solo drafts" on public.solo_draft_actions
for select to authenticated using (
  exists (select 1 from public.solo_drafts d where d.id = draft_id and d.user_id = (select auth.uid()))
);

-- The signed-in player's draft with this id, locked for the rest of the transaction; raises when it is someone
-- else's, unknown or ended.
create function public.my_open_solo_draft(draft uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  perform 1 from public.solo_drafts d
  where d.id = draft and d.user_id = (select auth.uid()) and d.ended_at is null
  for update;
  if not found then
    raise exception 'This draft has ended' using errcode = 'P0002';
  end if;
end;
$$;

-- The draft as it stands: each hero's latest action, without the ones taken back out.
create function public.solo_draft_state(draft uuid)
returns table (hero_id smallint, kind text, "position" smallint)
language sql
stable
security definer
set search_path = ''
as $$
  select s.hero_id, s.kind, s.position from (
    select distinct on (a.hero_id) a.hero_id, a.kind, a.position
    from public.solo_draft_actions a
    join public.solo_drafts d on d.id = a.draft_id
    where a.draft_id = draft and d.user_id = (select auth.uid())
    order by a.hero_id, a.id desc
  ) s
  where s.kind <> 'remove'
$$;

-- The signed-in player's open draft, started now if there is none. A draft nobody has touched for 2 hours is
-- ended first, so last night's board doesn't fill the phone.
create function public.start_solo_draft()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  draft uuid;
  last_touch timestamptz;
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  -- Locks the player's profile so two tabs starting at once get the same draft.
  perform 1 from public.profiles where id = me for update;
  select d.id, greatest(d.created_at, (select max(a.created_at) from public.solo_draft_actions a where a.draft_id = d.id))
  into draft, last_touch
  from public.solo_drafts d where d.user_id = me and d.ended_at is null;
  if draft is not null and last_touch < now() - interval '2 hours' then
    update public.solo_drafts set ended_at = now() where id = draft;
    draft := null;
  end if;
  if draft is null then
    insert into public.solo_drafts (user_id) values (me) returning id into draft;
  end if;
  return draft;
end;
$$;

-- Start Over: ends the open draft and starts a new one, which the player's other devices pick up live.
create function public.new_solo_draft()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  draft uuid;
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  perform 1 from public.profiles where id = me for update;
  update public.solo_drafts set ended_at = now() where user_id = me and ended_at is null;
  insert into public.solo_drafts (user_id) values (me) returning id into draft;
  return draft;
end;
$$;

-- Adds one action to the signed-in player's open draft, after checking it fits: a hero is in the draft once, a
-- team has 5 picks, a draft has at most 24 bans, and `remove` needs the hero to be in. Entering a pick again only
-- changes its position. An entry that changes nothing is skipped without an error: Watch Dota can send the same
-- read twice before the page shows the first.
create function public.add_solo_draft_action(draft uuid, action text, hero smallint, pos smallint, device text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_kind text;
  current_pos smallint;
begin
  if action not in ('ally', 'enemy', 'ban', 'remove') then
    raise exception 'Unknown draft action' using errcode = '22023';
  end if;
  if pos is not null and action not in ('ally', 'enemy') then
    raise exception 'Only picks have a position' using errcode = '22023';
  end if;
  if hero is null or hero <= 0 or (pos is not null and pos not between 1 and 5) then
    raise exception 'Unknown hero or position' using errcode = '22023';
  end if;
  if device is null or char_length(device) not between 1 and 64 then
    raise exception 'Missing device' using errcode = '22023';
  end if;
  perform public.my_open_solo_draft(draft);
  if (select count(*) from public.solo_draft_actions a where a.draft_id = draft) >= 200 then
    raise exception 'Too many changes to this draft. Start a new one.' using errcode = '54000';
  end if;

  select s.kind, s.position into current_kind, current_pos from public.solo_draft_state(draft) s where s.hero_id = hero;
  if action = 'remove' then
    if current_kind is null then
      return;
    end if;
  elsif current_kind = action and current_pos is not distinct from pos then
    return;
  elsif current_kind is not null and not (action in ('ally', 'enemy') and current_kind = action) then
    raise exception 'That hero is already in the draft' using errcode = '23505';
  elsif action in ('ally', 'enemy') and current_kind is null
    and (select count(*) from public.solo_draft_state(draft) s where s.kind = action) >= 5 then
    raise exception 'That team already has 5 picks' using errcode = '54000';
  elsif action = 'ban' and (select count(*) from public.solo_draft_state(draft) s where s.kind = 'ban') >= 24 then
    raise exception 'Too many bans' using errcode = '54000';
  end if;

  insert into public.solo_draft_actions (draft_id, kind, hero_id, position, device)
  values (draft, action, hero, pos, add_solo_draft_action.device);
end;
$$;

-- Your side this game, found by Watch Dota or chosen by hand, for the other device.
create function public.set_solo_draft_side(draft uuid, side text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if side is not null and side not in ('radiant', 'dire') then
    raise exception 'Unknown side' using errcode = '22023';
  end if;
  perform public.my_open_solo_draft(draft);
  update public.solo_drafts d set side = set_solo_draft_side.side
  where d.id = draft and d.side is distinct from set_solo_draft_side.side;
end;
$$;

-- The PC tells the phone it is reading the Dota window (true), or that it stopped (false).
create function public.solo_draft_beat(draft uuid, watching boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.my_open_solo_draft(draft);
  update public.solo_drafts set watching_at = case when watching then now() end where id = draft;
end;
$$;

-- A phone following the draft is open, so the PC can show Phone Following.
create function public.solo_draft_seen(draft uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.my_open_solo_draft(draft);
  update public.solo_drafts set phone_seen_at = now() where id = draft;
end;
$$;

-- The side, the beat and phone times as stored (live updates carry the same values, so a page can tell a new one
-- from an old one), and how many seconds ago each was, counted on the server so the devices' clocks don't matter.
-- Null when never or stopped.
create function public.solo_draft_status(draft uuid)
returns table (side text, watching_at timestamptz, phone_seen_at timestamptz, watch_age double precision,
  phone_age double precision)
language sql
stable
security invoker
set search_path = ''
as $$
  select d.side, d.watching_at, d.phone_seen_at,
    extract(epoch from now() - d.watching_at)::double precision,
    extract(epoch from now() - d.phone_seen_at)::double precision
  from public.solo_drafts d
  where d.id = draft and d.user_id = (select auth.uid())
$$;

-- Signing in a phone from the PC with a QR code. A code works once, for 60 seconds. Only its hash is kept.
create table public.phone_sign_ins (
  code_hash bytea primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  expires_at timestamptz not null
);

create index phone_sign_ins_user_idx on public.phone_sign_ins (user_id);

alter table public.phone_sign_ins enable row level security;
revoke all on public.phone_sign_ins from anon, authenticated;

-- A new code for the signed-in player. Their older codes stop working.
create function public.create_phone_sign_in()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  code text := rtrim(translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/', '-_'), '=');
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  delete from public.phone_sign_ins where user_id = me or expires_at < now();
  insert into public.phone_sign_ins (code_hash, user_id, expires_at)
  values (sha256(convert_to(code, 'UTF8')), me, now() + interval '60 seconds');
  return code;
end;
$$;

-- Uses up a code and returns whose it was; null when it is unknown, used or expired. Only the phone-sign-in
-- function calls this.
create function public.redeem_phone_sign_in(code text)
returns uuid
language sql
security definer
set search_path = ''
as $$
  delete from public.phone_sign_ins
  where code_hash = sha256(convert_to(redeem_phone_sign_in.code, 'UTF8')) and expires_at > now()
  returning user_id
$$;

revoke execute on function public.my_open_solo_draft, public.solo_draft_state, public.start_solo_draft,
  public.new_solo_draft, public.add_solo_draft_action, public.set_solo_draft_side, public.solo_draft_beat,
  public.solo_draft_seen, public.solo_draft_status, public.create_phone_sign_in, public.redeem_phone_sign_in
  from public, anon;
revoke execute on function public.my_open_solo_draft, public.redeem_phone_sign_in from authenticated;
grant execute on function public.solo_draft_state, public.start_solo_draft, public.new_solo_draft,
  public.add_solo_draft_action, public.set_solo_draft_side, public.solo_draft_beat, public.solo_draft_seen,
  public.solo_draft_status, public.create_phone_sign_in to authenticated;
grant execute on function public.redeem_phone_sign_in to service_role;

-- Live updates for the player's other devices.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.solo_drafts, public.solo_draft_actions;
  end if;
end;
$$;
