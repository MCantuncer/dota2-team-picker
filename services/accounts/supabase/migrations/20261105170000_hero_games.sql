-- The player's games of the last six months, one entry per game as [hero_id, won (1 or 0),
-- start_time in Unix seconds], newest first. hero_stats only holds per-hero totals with no
-- dates, so the Profile works out any shorter period (a week, a month, three months) from
-- this list instead. Written by the profile sync only: players can still update just
-- display_name and avatar_url (column grant in 20261022000000_profiles.sql).
alter table public.profiles
  add column hero_games jsonb not null default '[]'::jsonb;
