-- Post-game reports: one per party draft whose match was found. The build-reports job
-- fills them from the OpenDota match, first a basic report, then the full one once the
-- replay is parsed. Only the job writes (service role); the draft's players read their
-- report through draft_players.
--
-- Raw matches are kept gzipped in the private match-data bucket for 90 days, so facts
-- can be worked out again when the report gets new sections; match_files lists them so
-- the cleanup can find old and orphaned files.

create table public.match_reports (
  draft_id uuid primary key references public.party_drafts (id) on delete cascade,
  match_id bigint not null check (match_id > 0),
  -- waiting_parse: built from the unparsed match (or not yet), the job keeps asking for
  -- a parse. ready: built from the parsed match. basic: no parse came, final. failed:
  -- the job gave up after repeated errors, see error.
  status text not null default 'waiting_parse'
    check (status in ('waiting_parse', 'ready', 'basic', 'failed')),
  -- The report's numbers, in the shape of the Facts schema for facts_version.
  facts jsonb check (facts is null or jsonb_typeof(facts) = 'object'),
  facts_version smallint check (facts_version > 0),
  -- From the match, so records can leave out Turbo and other modes.
  game_mode smallint,
  lobby_type smallint,
  parse_requests smallint not null default 0 check (parse_requests >= 0),
  parse_requested_at timestamptz,
  -- Errors in a row, and the last one.
  attempts smallint not null default 0 check (attempts >= 0),
  error text check (char_length(error) <= 500),
  -- The job's next look, and the claim that keeps two runs off the same report.
  next_try_at timestamptz not null default now(),
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((facts is null) = (facts_version is null)),
  check (status not in ('ready', 'basic') or facts is not null)
);

create index match_reports_due_idx on public.match_reports (next_try_at) where status = 'waiting_parse';
create index match_reports_match_id_idx on public.match_reports (match_id);

create table public.match_files (
  match_id bigint primary key check (match_id > 0),
  saved_at timestamptz not null default now(),
  size_bytes integer not null check (size_bytes > 0)
);

alter table public.match_reports enable row level security;
alter table public.match_files enable row level security;
revoke insert, update, delete on public.match_reports, public.match_files from anon, authenticated;
revoke select on public.match_files from anon, authenticated;

create policy "Read the reports of drafts you played" on public.match_reports
for select to authenticated using (public.played_draft(draft_id));

-- Private bucket for raw matches. No policies, so only the service role reads or writes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('match-data', 'match-data', false, 5242880, array['application/gzip'])
on conflict (id) do nothing;
