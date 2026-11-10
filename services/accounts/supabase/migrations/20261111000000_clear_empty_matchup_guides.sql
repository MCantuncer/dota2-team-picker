-- Until 2026-11-11 the matchup lookup read STRATZ's guide lists in the wrong shape, so every slice it
-- fetched was saved with no games. Those rows count as fresh for 7 days and would stop the fixed lookup
-- from asking again. They hold nothing, so dropping them loses nothing; the next lookups refill them.
delete from public.matchup_guides where games = '[]'::jsonb;
