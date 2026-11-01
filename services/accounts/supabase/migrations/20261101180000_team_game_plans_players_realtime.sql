-- Two additions so a sent plan works on players' Party pages, where time is short once the draft
-- ends:
--   players: who plays each position when the plan was sent (players[1] is the carry), so each
--   player sees their own card first. Members can't read the team's lineup, so it travels with
--   the plan. A slot can be empty.
--   Realtime: a plan shows up at once instead of on the next reload. Realtime still applies the
--   select policy, so a player only hears about plans for their own teams.
alter table public.team_game_plans
  add column players uuid[] not null default '{null,null,null,null,null}'
  check (cardinality(players) = 5);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.team_game_plans;
  end if;
end;
$$;
