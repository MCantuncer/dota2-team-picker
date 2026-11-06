-- Which version of the findings rules (_shared/feedback/findings.ts FINDINGS_VERSION) wrote
-- player_game_facts.findings. The refresh-trends job works out the findings again from the
-- saved summary for rows on an older version, with no OpenDota calls, so a fixed rule reaches
-- games that were already read. Rows before this column count as version 0.
alter table public.player_game_facts
  add column findings_version integer not null default 0;
