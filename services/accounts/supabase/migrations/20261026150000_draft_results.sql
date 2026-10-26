-- The match a party draft turned into and whether the party won, for the after-game
-- card and later reports. Only the draft-result edge function writes these, after it
-- checks the match against the draft's heroes on OpenDota; the party reads them
-- through the existing policy on party_drafts.

alter table public.party_drafts
  add column match_id bigint check (match_id > 0),
  add column won boolean,
  -- When the function last looked, so repeated clicks don't spend OpenDota requests.
  add column result_checked_at timestamptz,
  add constraint party_drafts_result_check check ((match_id is null) = (won is null));
