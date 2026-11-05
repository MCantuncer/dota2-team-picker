-- The per-hero record for shorter periods, so the Profile can show the last week, month or
-- three months next to the six month record in hero_stats. Keyed by days ("7", "30", "90"),
-- each value shaped like hero_stats. Written by the profile sync only: players can still
-- update just display_name and avatar_url (column grant in 20261022000000_profiles.sql).
alter table public.profiles
  add column hero_stats_periods jsonb not null default '{}'::jsonb;
