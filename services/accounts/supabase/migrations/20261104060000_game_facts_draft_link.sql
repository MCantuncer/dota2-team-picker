-- Links each saved game (player_game_facts) to the party draft it came from, so the game's
-- feedback page can open the party report and the report can open the player's own game.
-- A game and its draft can arrive in either order: the job may save the game first and the
-- draft's match be found later, or the other way round. A trigger on each side fills
-- draft_id, and existing rows are linked once here.

create function public.link_game_fact_draft()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.draft_id is null then
    select d.id into new.draft_id
    from public.party_drafts d
    join public.draft_players p on p.draft_id = d.id and p.user_id = new.user_id
    where d.match_id = new.match_id
    order by d.ended_at desc nulls last
    limit 1;
  end if;
  return new;
end;
$$;

revoke execute on function public.link_game_fact_draft() from public, anon, authenticated;

create trigger player_game_facts_link_draft
before insert on public.player_game_facts
for each row execute function public.link_game_fact_draft();

create function public.link_draft_game_facts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.player_game_facts f
  set draft_id = new.id
  from public.draft_players p
  where p.draft_id = new.id
    and f.user_id = p.user_id
    and f.match_id = new.match_id
    and f.draft_id is null;
  return null;
end;
$$;

revoke execute on function public.link_draft_game_facts() from public, anon, authenticated;

create trigger party_drafts_link_game_facts
after update of match_id on public.party_drafts
for each row when (new.match_id is not null and old.match_id is distinct from new.match_id)
execute function public.link_draft_game_facts();

update public.player_game_facts f
set draft_id = d.id
from public.party_drafts d
join public.draft_players p on p.draft_id = d.id
where f.draft_id is null and d.match_id = f.match_id and p.user_id = f.user_id;
