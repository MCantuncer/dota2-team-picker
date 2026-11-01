-- The suggestions each player was shown in a party draft, saved so the after-game
-- card and later reports can compare them with what was picked and how the game went.
--
-- One row per player per draft, overwritten while the draft runs, so it holds the
-- last list shown before the player picked. The pick itself, and when it was made,
-- are already in draft_actions; first_shown_at is when this player first saw a list,
-- which gives how long the pick took. Rows are written only through the function
-- below, and the party that played the draft can read them.

create table public.draft_suggestions (
  draft_id uuid not null references public.party_drafts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- The position the suggestions were for, 1 carry ... 5 hard support.
  position smallint not null check (position between 1 and 5),
  -- The heroes shown, best first, and the engine's score for each.
  heroes smallint[] not null check (cardinality(heroes) between 1 and 8 and 0 < all (heroes)),
  scores real[] not null,
  -- The team's win chance when the list was shown, when the checked model gave one.
  win_chance real check (win_chance between 0 and 1),
  first_shown_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (draft_id, user_id),
  check (cardinality(scores) = cardinality(heroes))
);

create index draft_suggestions_user_id_idx on public.draft_suggestions (user_id);

alter table public.draft_suggestions enable row level security;
revoke insert, update, delete on public.draft_suggestions from anon, authenticated;

create policy "Read the suggestions of your party's drafts" on public.draft_suggestions
for select to authenticated using (public.in_draft_party(draft_id));

-- Saves the list the signed-in player is looking at in an open draft of their party.
-- The screen calls it when the list changes; a later call replaces the list and keeps
-- first_shown_at.
create function public.save_draft_suggestions(draft uuid, pos smallint, shown smallint[], shown_scores real[], chance real default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.in_draft_party(draft) then
    raise exception 'Draft not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.party_drafts where id = draft and ended_at is null) then
    raise exception 'This draft has ended' using errcode = 'P0002';
  end if;
  insert into public.draft_suggestions (draft_id, user_id, position, heroes, scores, win_chance)
  values (draft, (select auth.uid()), pos, shown, shown_scores, chance)
  on conflict (draft_id, user_id) do update
    set position = excluded.position, heroes = excluded.heroes, scores = excluded.scores,
      win_chance = excluded.win_chance, updated_at = now();
end;
$$;

revoke execute on function public.save_draft_suggestions from public, anon;
grant execute on function public.save_draft_suggestions to authenticated;
