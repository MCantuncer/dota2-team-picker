-- Players are in a hurry once the draft ends, so a plan the captain sends shows up on their Party
-- page at once instead of on the next reload. Realtime still applies the select policy, so a
-- player only hears about plans for their own teams.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.team_game_plans;
  end if;
end;
$$;
