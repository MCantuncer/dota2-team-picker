-- Game feedback, worked out by the refresh-trends job from player_game_facts summaries
-- (_shared/feedback/findings.ts and profile.ts), so the site only shows it:
-- - player_game_facts.findings: the strengths and problems of that one game.
-- - player_feedback: each player's top strengths and problems over their recent games, and
--   last week's problems that are gone this week.
-- Players read only their own rows; only the job writes.

alter table public.player_game_facts
  add column findings jsonb check (findings is null or jsonb_typeof(findings) = 'array');

create table public.player_feedback (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  -- The PlayerFeedback shape version; the site reads every version it knows.
  version smallint not null check (version > 0),
  findings jsonb not null check (jsonb_typeof(findings) = 'array'),
  improved jsonb not null check (jsonb_typeof(improved) = 'array'),
  -- Games behind it, and how many of them OpenDota had parsed.
  games smallint not null check (games >= 0),
  parsed_games smallint not null check (parsed_games between 0 and games),
  -- The first and last game in the window, null with no games.
  first_game_at timestamptz,
  last_game_at timestamptz,
  updated_at timestamptz not null default now(),
  check ((first_game_at is null) = (games = 0)),
  check ((first_game_at is null) = (last_game_at is null))
);

create trigger player_feedback_touch_updated_at
before update on public.player_feedback
for each row execute function public.touch_updated_at();

alter table public.player_feedback enable row level security;
revoke insert, update, delete on public.player_feedback from anon, authenticated;

create policy "Read own feedback" on public.player_feedback
for select to authenticated using ((select auth.uid()) = user_id);
