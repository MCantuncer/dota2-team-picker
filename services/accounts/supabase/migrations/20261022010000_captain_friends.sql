-- Captain mode: friends a captain drafts for, and their favorite heroes.
--
-- A friend is a profile the captain owns, not a login: the friend never gets
-- an email and does not need an account. Each captain sees and changes only
-- their own friends.

create table public.friends (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  -- Usual position, 1 carry ... 5 hard support. Null when the friend plays anything.
  usual_position smallint check (usual_position between 1 and 5),
  created_at timestamptz not null default now()
);

create index friends_owner_id_idx on public.friends (owner_id);

create table public.friend_favorite_heroes (
  friend_id uuid not null references public.friends (id) on delete cascade,
  hero_id smallint not null check (hero_id > 0),
  created_at timestamptz not null default now(),
  primary key (friend_id, hero_id)
);

-- The lineup the captain used last: which friend plays which position, and the party rank.
create table public.captain_lineups (
  owner_id uuid primary key references public.profiles (id) on delete cascade,
  -- Five entries, one per position; null means not a friend.
  slots uuid[] not null default array[null, null, null, null, null]::uuid[] check (cardinality(slots) = 5),
  -- Rank bracket 1 Herald ... 8 Immortal, null for all ranks.
  rank_bracket smallint check (rank_bracket between 1 and 8),
  updated_at timestamptz not null default now()
);

create trigger captain_lineups_touch_updated_at
before update on public.captain_lineups
for each row execute function public.touch_updated_at();

alter table public.friends enable row level security;
alter table public.friend_favorite_heroes enable row level security;
alter table public.captain_lineups enable row level security;

create policy "Manage own friends" on public.friends
for all to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy "Manage own friends' favorites" on public.friend_favorite_heroes
for all to authenticated
using (exists (select 1 from public.friends f where f.id = friend_id and f.owner_id = (select auth.uid())))
with check (exists (select 1 from public.friends f where f.id = friend_id and f.owner_id = (select auth.uid())));

create policy "Manage own lineup" on public.captain_lineups
for all to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);
