-- Game plans a captain sends to their team once all ten heroes are in. Friends don't open the
-- Captain board, so the owner or a co-captain sends the finished draft and every member sees the
-- plan on their Party page. Only the draft is stored; each screen works out the plan from it with
-- the same engine, so a member always sees the current builds and wording.

create table public.team_game_plans (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  sent_by uuid not null references public.profiles (id) on delete cascade,
  -- Our heroes by position: picks[1] is the carry ... picks[5] the hard support.
  picks smallint[] not null check (cardinality(picks) = 5 and 0 < all (picks)),
  enemies smallint[] not null check (cardinality(enemies) = 5 and 0 < all (enemies)),
  bans smallint[] not null default '{}' check (cardinality(bans) <= 24 and 0 < all (bans)),
  rank_bracket smallint check (rank_bracket between 1 and 8),
  created_at timestamptz not null default now()
);

create index team_game_plans_team_id_idx on public.team_game_plans (team_id, created_at desc);
create index team_game_plans_sent_by_idx on public.team_game_plans (sent_by);

alter table public.team_game_plans enable row level security;

-- Members and whoever runs the team read its plans.
create policy "Read the game plans of your team" on public.team_game_plans
for select to authenticated using (public.is_team_member(team_id) or public.runs_team(team_id));

-- The owner or a co-captain sends a plan, in their own name. Plans are never changed afterwards.
create policy "Send a game plan to a team you run" on public.team_game_plans
for insert to authenticated with check ((select auth.uid()) = sent_by and public.runs_team(team_id));
