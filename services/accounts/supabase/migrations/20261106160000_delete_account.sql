-- Players can delete their own account. Deleting a player must never take other players' data with it:
-- their Stacks pass to the next player, an open party passes to the next member, and shared history
-- (closed parties, draft actions, sent game plans) stays with the player shown as gone (null).

alter table public.parties
  alter column leader_id drop not null,
  drop constraint parties_leader_id_fkey,
  add constraint parties_leader_id_fkey foreign key (leader_id) references public.profiles (id) on delete set null;

alter table public.draft_actions
  alter column actor_id drop not null,
  drop constraint draft_actions_actor_id_fkey,
  add constraint draft_actions_actor_id_fkey foreign key (actor_id) references public.profiles (id) on delete set null;

alter table public.team_game_plans
  alter column sent_by drop not null,
  drop constraint team_game_plans_sent_by_fkey,
  add constraint team_game_plans_sent_by_fkey foreign key (sent_by) references public.profiles (id) on delete set null;

-- Deletes the signed-in player's account and everything that is only theirs. Auth sessions go with it.
-- First their Stacks and open party pass to the players still in them, so nobody else loses anything.
-- (Deleting users from the dashboard or with SQL skips this hand-off and cascades as before.)
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  stack uuid;
  party uuid;
  next_player uuid;
  open_draft uuid;
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;

  -- A Stack goes to a co-captain first, then to whoever joined first. A Stack with nobody else goes with its owner.
  for stack in select t.id from public.teams t where t.owner_id = me for update loop
    select m.user_id into next_player from public.team_members m
    where m.team_id = stack and m.user_id <> me
    order by (m.role = 'co_captain') desc, m.joined_at, m.user_id
    limit 1;
    if next_player is not null then
      -- Owners are not listed as members.
      delete from public.team_members where team_id = stack and user_id = next_player;
      update public.teams set owner_id = next_player where id = stack;
    end if;
  end loop;

  -- An open party works the way Leave Party does: the next member leads, or the party closes.
  for party in select p.id from public.parties p where p.leader_id = me and p.closed_at is null for update loop
    select m.user_id into next_player from public.party_members m
    where m.party_id = party and m.user_id <> me
    order by m.joined_at, m.user_id
    limit 1;
    if next_player is null then
      update public.party_drafts set ended_at = now() where party_id = party and ended_at is null
      returning id into open_draft;
      if open_draft is not null then
        perform public.record_draft_players(open_draft);
      end if;
      update public.parties set closed_at = now() where id = party;
    else
      update public.parties set leader_id = next_player where id = party;
    end if;
  end loop;

  delete from auth.users where id = me;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
