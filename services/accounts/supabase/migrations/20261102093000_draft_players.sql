-- Who played each party draft, saved when the draft ends, so post-game reports and
-- records keep working after players leave the party or new ones join.
--
-- Until now every read of a draft went through current party membership: a player
-- who left lost the draft, and a player who joined later could read the party's old
-- drafts. From here on an open draft is readable by the party, and an ended draft only
-- by the players saved for it here.
--
-- hero_id and hero_source stay empty until the draft's match is found (a later change
-- fills them from the match).

create table public.draft_players (
  draft_id uuid not null references public.party_drafts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- The player's Dota account (Steam ID minus 76561197960265728), when Steam is linked.
  account_id bigint check (account_id > 0),
  -- The position they played, 1 carry ... 5 hard support, when known.
  position smallint check (position between 1 and 5),
  hero_id smallint check (hero_id > 0),
  -- How hero_id was worked out: from their account in the match, or from the pick
  -- entered for their position when their match data is hidden.
  hero_source text check (hero_source in ('account', 'position')),
  primary key (draft_id, user_id),
  check ((hero_id is null) = (hero_source is null))
);

create index draft_players_user_id_idx on public.draft_players (user_id);

alter table public.draft_players enable row level security;
revoke insert, update, delete on public.draft_players from anon, authenticated;

-- True when the signed-in user was saved as a player of the draft.
create function public.played_draft(draft uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.draft_players p where p.draft_id = draft and p.user_id = (select auth.uid()))
$$;

-- True when the signed-in user may read the draft: the party while it is open, then its players.
create function public.can_read_draft(draft uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.party_drafts d
    where d.id = draft and ((d.ended_at is null and public.in_party(d.party_id)) or public.played_draft(d.id))
  )
$$;

create policy "Read the players of drafts you played" on public.draft_players
for select to authenticated using (public.played_draft(draft_id));

-- Saves the party's members as the draft's players. With joined_by, only members who
-- joined by then count (for drafts that ended without anyone ending them). Players
-- already saved are kept. Not callable by users.
create function public.record_draft_players(draft uuid, joined_by timestamptz default null)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.draft_players (draft_id, user_id, account_id, position)
  select d.id, m.user_id, pr.steam_id::bigint - 76561197960265728,
    coalesce(s.position, m.position)
  from public.party_drafts d
  join public.party_members m on m.party_id = d.party_id
  join public.profiles pr on pr.id = m.user_id
  left join public.draft_suggestions s on s.draft_id = d.id and s.user_id = m.user_id
  where d.id = draft and (joined_by is null or m.joined_at <= joined_by)
  on conflict (draft_id, user_id) do nothing
$$;

revoke execute on function public.record_draft_players from public, anon, authenticated;
revoke execute on function public.played_draft, public.can_read_draft from public, anon;
grant execute on function public.played_draft, public.can_read_draft to authenticated;

-- Reads of drafts follow can_read_draft instead of current membership.
drop policy "Read your party's drafts" on public.party_drafts;
create policy "Read drafts you can see" on public.party_drafts
for select to authenticated using (public.can_read_draft(id));

drop policy "Read the actions of your party's drafts" on public.draft_actions;
create policy "Read the actions of drafts you can see" on public.draft_actions
for select to authenticated using (public.can_read_draft(draft_id));

drop policy "Read the suggestions of your party's drafts" on public.draft_suggestions;
create policy "Read the suggestions of drafts you can see" on public.draft_suggestions
for select to authenticated using (public.can_read_draft(draft_id));

-- The draft as it stands, now for anyone who can read it (same body as before otherwise).
create or replace function public.draft_state(draft uuid)
returns table (hero_id smallint, kind text, "position" smallint)
language sql
stable
security definer
set search_path = ''
as $$
  select s.hero_id, s.kind, s.position from (
    select distinct on (a.hero_id) a.hero_id, a.kind, a.position
    from public.draft_actions a
    where a.draft_id = draft and public.can_read_draft(draft)
    order by a.hero_id, a.id desc
  ) s
  where s.kind <> 'remove'
$$;

-- Ends a draft when the game starts and saves who played it. Any party member can.
create or replace function public.end_party_draft(draft uuid)
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
  if found then
    perform public.record_draft_players(draft);
  end if;
end;
$$;

-- Takes the signed-in user out of their open party. If they led it, the player who
-- joined next becomes leader; the last one out closes it, and also ends the party's
-- open draft with them saved as its player, so the draft keeps its history.
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
  else
    update public.parties set leader_id = next_leader where id = party and leader_id = me;
  end if;
end;
$$;

-- Deleting the account that started a draft no longer deletes the draft for everyone.
alter table public.party_drafts alter column started_by drop not null;
alter table public.party_drafts drop constraint party_drafts_started_by_fkey;
alter table public.party_drafts add constraint party_drafts_started_by_fkey
  foreign key (started_by) references public.profiles (id) on delete set null;

-- Drafts that ended before this change: best effort, members who were already in the
-- party when the draft was opened. Players who joined later are left out on purpose.
select public.record_draft_players(id, created_at) from public.party_drafts where ended_at is not null;
