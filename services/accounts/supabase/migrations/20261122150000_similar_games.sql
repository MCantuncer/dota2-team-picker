-- Similar Games (similar-games function): after a draft, real high-rank games of each of our heroes against
-- the same enemies. Two caches so repeat drafts cost no OpenDota or STRATZ calls, claims so two calls at once
-- (party members opening the same draft) don't fetch the same thing twice, and a per user hourly limit.

-- One match as the function stores it: each player's hero, side, position, lane, Steam account, kills, deaths,
-- assists, net worth, last hits at 10 min, first buy minute of each finished item, and deaths with their attacker.
-- Match data never changes, so a row is written once. The Steam accounts never leave the function.
create table public.similar_matches (
  match_id bigint primary key check (match_id > 0),
  game jsonb not null check (jsonb_typeof(game) = 'object'),
  fetched_at timestamptz not null default now()
);

create index similar_matches_fetched_at_idx on public.similar_matches (fetched_at);

alter table public.similar_matches enable row level security;
revoke all on public.similar_matches from anon, authenticated;

-- One game search (one hero against one set of enemies, with one set of allies, in one patch) and its answer:
-- the counts and the most similar match ids. The function treats rows older than 6 hours as stale.
create table public.similar_searches (
  search_key text primary key check (char_length(search_key) between 1 and 200),
  answer jsonb not null check (jsonb_typeof(answer) = 'object'),
  fetched_at timestamptz not null default now()
);

create index similar_searches_fetched_at_idx on public.similar_searches (fetched_at);

alter table public.similar_searches enable row level security;
revoke all on public.similar_searches from anon, authenticated;

-- Searches ('s:' + search key) and matches ('m:' + match id) being fetched right now. A claim older than
-- 60 seconds is stale (its function died) and can be taken again.
create table public.similar_claims (
  claim_key text primary key check (char_length(claim_key) between 3 and 202),
  claimed_at timestamptz not null default now()
);

alter table public.similar_claims enable row level security;
revoke all on public.similar_claims from anon, authenticated;

-- Claims the keys in `wanted` (at most 200), skipping ones another call claimed in the last 60 seconds. Returns
-- the claimed keys. The function deletes its claims once it saved what it fetched. Service role only.
create function public.claim_similar_fetches(wanted text[])
returns text[]
language sql
security definer
set search_path = ''
as $$
  with asked as (
    select distinct k from unnest(coalesce(wanted[1:200], '{}')) k
    where char_length(k) between 3 and 202
  ),
  claimed as (
    insert into public.similar_claims as c (claim_key)
    select k from asked
    on conflict (claim_key) do update set claimed_at = now()
      where c.claimed_at < now() - interval '60 seconds'
    returning c.claim_key
  )
  select coalesce(array_agg(claim_key order by claim_key), '{}') from claimed
$$;

-- Lookups per signed-in user that had to call OpenDota or STRATZ, for the hourly limit.
create table public.similar_lookups (
  user_id uuid not null references auth.users (id) on delete cascade,
  looked_up_at timestamptz not null default now()
);

create index similar_lookups_user_idx on public.similar_lookups (user_id, looked_up_at);

alter table public.similar_lookups enable row level security;
revoke all on public.similar_lookups from anon, authenticated;

-- Takes one lookup for `who` when they made fewer than `hourly_cap` in the last hour. The function passes the
-- caller's id from their verified token. A lookup answered fully from the caches does not call this.
-- Service role only.
create function public.take_similar_lookup(who uuid, hourly_cap integer default 30)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- One caller per user at a time, so two tabs can't both take the last lookup.
  perform pg_advisory_xact_lock(hashtextextended('similar_lookup:' || who::text, 0));
  if (select count(*) from public.similar_lookups
      where user_id = who and looked_up_at > now() - interval '1 hour') >= hourly_cap then
    return false;
  end if;
  insert into public.similar_lookups (user_id) values (who);
  return true;
end;
$$;

-- Old rows go once a day: matches after 30 days (a patch rarely lasts longer, and a new patch searches only
-- its own games), searches after 2 days, lookups after a day, stale claims after an hour.
create function public.forget_old_similar_games()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.similar_matches where fetched_at < now() - interval '30 days';
  delete from public.similar_searches where fetched_at < now() - interval '2 days';
  delete from public.similar_lookups where looked_up_at < now() - interval '1 day';
  delete from public.similar_claims where claimed_at < now() - interval '1 hour';
$$;

revoke execute on function public.claim_similar_fetches, public.take_similar_lookup, public.forget_old_similar_games
  from public, anon, authenticated;
grant execute on function public.claim_similar_fetches, public.take_similar_lookup to service_role;

select cron.schedule('forget-old-similar-games', '27 4 * * *', 'select public.forget_old_similar_games()');
