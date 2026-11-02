-- Once a party has a draft captain, the draft is theirs: only the captain adds, changes or removes
-- heroes and ends the draft, and the team plan (everyone's favorite heroes) goes to the captain
-- instead of the leader. Without a captain, the party works as before: anyone enters the draft
-- and the leader plans.
--
-- start_party_draft stays open to every member: it only finds or starts the open draft, and
-- every player's screen calls it when a draft ends. Leaving the party also still ends the draft
-- for the last player out, captain or not.

-- True when the signed-in user may change this party draft: there is no captain, or it is them.
create function public.may_change_draft(draft uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p.captain_id is null or p.captain_id = (select auth.uid()), false)
  from public.party_drafts d join public.parties p on p.id = d.party_id
  where d.id = draft
$$;

create or replace function public.add_draft_action(draft uuid, action text, hero smallint, pos smallint default null)
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
  if not public.may_change_draft(draft) then
    raise exception 'Only the draft captain can change the draft' using errcode = '42501';
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
  if not public.may_change_draft(draft) then
    raise exception 'Only the draft captain can change the draft' using errcode = '42501';
  end if;
  update public.party_drafts set ended_at = now() where id = draft and ended_at is null;
  if found then
    perform public.record_draft_players(draft);
  end if;
end;
$$;

-- The team plan reads every member's favorite heroes: the draft captain's, or the leader's while
-- the party has no captain. Party members chose to play together, so whoever runs the draft
-- sees the pool, for as long as those players are in the party.
create or replace function public.party_hero_pool()
returns table (user_id uuid, "position" smallint, hero_id smallint)
language sql
stable
security definer
set search_path = ''
as $$
  select f.user_id, f.position, f.hero_id
  from public.parties p
  join public.party_members m on m.party_id = p.id
  join public.favorite_heroes f on f.user_id = m.user_id
  where p.id = public.my_party() and coalesce(p.captain_id, p.leader_id) = (select auth.uid()) and p.closed_at is null
  order by f.user_id, f.position, f.created_at
$$;

revoke execute on function public.may_change_draft from public, anon, authenticated;
