-- Players can set where each enemy hero plays, since the engine's guess is often wrong for heroes
-- played in more than one position. A draft action's position is now allowed on enemy picks too, and
-- entering an enemy again only changes its position, the same as for allies. Bans still have none.

alter table public.draft_actions drop constraint draft_actions_check;
alter table public.draft_actions add constraint draft_actions_position_kind_check
  check (position is null or kind in ('ally', 'enemy'));

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
  if pos is not null and action not in ('ally', 'enemy') then
    raise exception 'Only picks have a position' using errcode = '22023';
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
  elsif current_kind is not null and not (action in ('ally', 'enemy') and current_kind = action) then
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
