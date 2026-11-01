-- Live party drafts: the whole party sees one draft, and anyone in it can enter
-- picks and bans while the game's draft runs. Each player's screen works out
-- suggestions for their own position from it.
--
-- A draft is a list of actions that are only ever added, never changed, so two
-- players typing at once cannot erase each other's entries. The screen replays
-- the actions in order to get the draft. Everything that changes a draft goes
-- through the functions below; the tables are read-only to users. Both tables
-- are in the realtime publication, and row level security decides who receives
-- which change.

create table public.party_drafts (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references public.parties (id) on delete cascade,
  started_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  ended_at timestamptz
);

-- One open draft per party at a time.
create unique index party_drafts_open_idx on public.party_drafts (party_id) where ended_at is null;

create table public.draft_actions (
  id bigint generated always as identity primary key,
  draft_id uuid not null references public.party_drafts (id) on delete cascade,
  actor_id uuid not null references public.profiles (id) on delete cascade,
  -- ally / enemy: a pick for that team. ban: a banned hero. remove: takes the hero back out.
  kind text not null check (kind in ('ally', 'enemy', 'ban', 'remove')),
  hero_id smallint not null check (hero_id > 0),
  -- The ally's position when the player typed one (cm5), 1 carry ... 5 hard support.
  position smallint check (position between 1 and 5),
  created_at timestamptz not null default now(),
  check (position is null or kind = 'ally')
);

create index draft_actions_draft_id_idx on public.draft_actions (draft_id, id);

-- True when the signed-in user is in the party the draft belongs to.
create function public.in_draft_party(draft uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.party_drafts d where d.id = draft and public.in_party(d.party_id))
$$;

-- The draft as it stands: each hero's latest action, without the ones taken back out.
create function public.draft_state(draft uuid)
returns table (hero_id smallint, kind text, "position" smallint)
language sql
stable
security definer
set search_path = ''
as $$
  select s.hero_id, s.kind, s.position from (
    select distinct on (a.hero_id) a.hero_id, a.kind, a.position
    from public.draft_actions a
    where a.draft_id = draft and public.in_draft_party(draft)
    order by a.hero_id, a.id desc
  ) s
  where s.kind <> 'remove'
$$;

alter table public.party_drafts enable row level security;
alter table public.draft_actions enable row level security;
revoke insert, update, delete on public.party_drafts, public.draft_actions from anon, authenticated;

create policy "Read your party's drafts" on public.party_drafts
for select to authenticated using (public.in_party(party_id));

create policy "Read the actions of your party's drafts" on public.draft_actions
for select to authenticated using (public.in_draft_party(draft_id));

-- The open draft of the signed-in user's party, started now if there is none. Returns its id.
create function public.start_party_draft()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  party uuid := public.my_party();
  draft uuid;
begin
  if party is null then
    raise exception 'Join or start a party first' using errcode = 'P0002';
  end if;
  -- Locks the party so two players starting at once get the same draft.
  perform 1 from public.parties where id = party for update;
  select id into draft from public.party_drafts where party_id = party and ended_at is null;
  if draft is null then
    insert into public.party_drafts (party_id, started_by) values (party, me) returning id into draft;
  end if;
  return draft;
end;
$$;

-- Ends a draft when the game starts, so the next game gets a fresh one. Any party member can.
create function public.end_party_draft(draft uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.in_draft_party(draft) then
    raise exception 'Draft not found' using errcode = 'P0002';
  end if;
  update public.party_drafts set ended_at = now() where id = draft and ended_at is null;
end;
$$;

-- Adds one action to an open draft of the signed-in user's party, after checking it fits:
-- a hero is in the draft once, a team has 5 picks, a draft has at most 24 bans, and
-- `remove` needs the hero to be in. Entering an ally again only changes its position.
create function public.add_draft_action(draft uuid, action text, hero smallint, pos smallint default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_kind text;
begin
  if action not in ('ally', 'enemy', 'ban', 'remove') then
    raise exception 'Unknown draft action' using errcode = '22023';
  end if;
  if pos is not null and action <> 'ally' then
    raise exception 'Only your own team''s picks have a position' using errcode = '22023';
  end if;
  if not public.in_draft_party(draft) then
    raise exception 'Draft not found' using errcode = 'P0002';
  end if;
  -- Locks the draft so two entries at once are checked one after the other.
  perform 1 from public.party_drafts where id = draft and ended_at is null for update;
  if not found then
    raise exception 'This draft has ended' using errcode = 'P0002';
  end if;
  if (select count(*) from public.draft_actions where draft_id = draft) >= 200 then
    raise exception 'Too many changes to this draft. Start a new one.' using errcode = '54000';
  end if;

  select s.kind into current_kind from public.draft_state(draft) s where s.hero_id = hero;
  if action = 'remove' then
    if current_kind is null then
      raise exception 'That hero is not in the draft' using errcode = 'P0002';
    end if;
  elsif current_kind is not null and not (action = 'ally' and current_kind = 'ally') then
    raise exception 'That hero is already in the draft' using errcode = '23505';
  elsif action in ('ally', 'enemy') and current_kind is null
    and (select count(*) from public.draft_state(draft) s where s.kind = action) >= 5 then
    raise exception 'That team already has 5 picks' using errcode = '54000';
  elsif action = 'ban' and (select count(*) from public.draft_state(draft) s where s.kind = 'ban') >= 24 then
    raise exception 'Too many bans' using errcode = '54000';
  end if;

  insert into public.draft_actions (draft_id, actor_id, kind, hero_id, position)
  values (draft, (select auth.uid()), action, hero, pos);
end;
$$;

revoke execute on function public.in_draft_party, public.draft_state, public.start_party_draft,
  public.end_party_draft, public.add_draft_action from public, anon;
grant execute on function public.in_draft_party, public.draft_state, public.start_party_draft,
  public.end_party_draft, public.add_draft_action to authenticated;

-- Live updates for everyone's draft screen.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.party_drafts, public.draft_actions;
  end if;
end;
$$;
