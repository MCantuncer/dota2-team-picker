-- Each of a player's recent games with its feedback summary (_shared/feedback/summary.ts),
-- for the "Your Games" page and its previous games list. The refresh-trends job writes the
-- rows; players read only their own. Kept 60 days, then the job removes them.

create table public.player_game_facts (
  user_id uuid not null references public.profiles (id) on delete cascade,
  match_id bigint not null check (match_id > 0),
  hero_id smallint not null check (hero_id > 0),
  -- 1 carry ... 5 hard support, when a source could tell.
  position smallint check (position between 1 and 5),
  is_win boolean not null,
  started_at timestamptz not null,
  duration_s integer not null check (duration_s > 0),
  -- waiting_parse: the job keeps asking OpenDota for a parse. parsed: built from the parsed
  -- match. basic: no parse came (or the game was too old), built from the basic numbers.
  status text not null default 'waiting_parse' check (status in ('waiting_parse', 'parsed', 'basic')),
  -- The GameSummary for summary_version, once built.
  summary jsonb check (summary is null or jsonb_typeof(summary) = 'object'),
  summary_version smallint check (summary_version > 0),
  -- The party draft this game came from, so the page can link its full report.
  draft_id uuid references public.party_drafts (id) on delete set null,
  parse_requests smallint not null default 0 check (parse_requests >= 0),
  parse_requested_at timestamptz,
  -- Errors in a row, and the last one.
  attempts smallint not null default 0 check (attempts >= 0),
  error text check (char_length(error) <= 500),
  next_try_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, match_id),
  check ((summary is null) = (summary_version is null)),
  check (status = 'waiting_parse' or summary is not null)
);

create index player_game_facts_user_started_idx on public.player_game_facts (user_id, started_at desc);
create index player_game_facts_due_idx on public.player_game_facts (next_try_at) where status = 'waiting_parse';
create index player_game_facts_started_idx on public.player_game_facts (started_at);
create index player_game_facts_draft_idx on public.player_game_facts (draft_id) where draft_id is not null;

create trigger player_game_facts_touch_updated_at
before update on public.player_game_facts
for each row execute function public.touch_updated_at();

alter table public.player_game_facts enable row level security;
revoke insert, update, delete on public.player_game_facts from anon, authenticated;

create policy "Read own game facts" on public.player_game_facts
for select to authenticated using ((select auth.uid()) = user_id);
