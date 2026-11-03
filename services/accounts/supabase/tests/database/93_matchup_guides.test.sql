begin;
\ir _helpers.psql
select plan(19);

select tests.create_user('player@example.com') as player \gset

-- Claims: a slice is claimed once, a stale claim can be taken again, bad input claims nothing.
select is(
  jsonb_array_length(public.claim_matchup_fetches('[{"hero":18,"position":1,"enemy":129},{"hero":18,"position":1,"enemy":26}]', 184)),
  2, 'new slices are claimed');
select is(public.claim_matchup_fetches('[{"hero":18,"position":1,"enemy":129}]', 184), '[]'::jsonb,
  'a slice claimed a moment ago is skipped');
select is(jsonb_array_length(public.claim_matchup_fetches('[{"hero":18,"position":1,"enemy":129}]', 185)), 1,
  'the same slice on another game version is its own claim');
update public.matchup_fetches set claimed_at = now() - interval '2 minutes' where enemy_id = 129 and game_version = 184;
select is(jsonb_array_length(public.claim_matchup_fetches('[{"hero":18,"position":1,"enemy":129}]', 184)), 1,
  'a stale claim is taken again');
select is(public.claim_matchup_fetches('{"hero":18}', 184), '[]'::jsonb, 'a non-array claims nothing');

-- Saving: rows land, claims are released, a second save replaces the games.
select is(public.save_matchup_guides(
  '[{"hero":18,"position":1,"enemy":129,"games":[{"match":1,"account":2,"won":true,"level":20,"points":[5,6]}]},
    {"hero":18,"position":1,"enemy":26,"games":[]}]', 184), 2, 'slices are saved, empty ones too');
select is((select count(*)::integer from public.matchup_fetches where game_version = 184), 0,
  'saving releases the claims');
select is(public.save_matchup_guides('[{"hero":18,"position":1,"enemy":129,"games":[]}]', 184), 1,
  'saving again replaces the slice');
select is((select games from public.matchup_guides where enemy_id = 129 and game_version = 184), '[]'::jsonb,
  'the newer games win');
select throws_ok($$select public.save_matchup_guides('[{"hero":18,"position":1,"enemy":129,"games":{}}]', 184)$$,
  '23514', null, 'games must be an array');

-- Budgets.
select is(public.take_stratz_calls(30, 40), true, 'STRATZ calls under the cap are taken');
select is(public.take_stratz_calls(11, 40), false, 'calls over the hourly cap are refused');
select is((select calls from public.stratz_calls), 30, 'a refused take takes nothing');

select is((select bool_and(public.take_matchup_lookup(:'player', 3)) from generate_series(1, 3)), true,
  'a user gets their lookups');
select is(public.take_matchup_lookup(:'player', 3), false, 'one more in the hour is refused');

-- The daily cleanup drops old cache rows and keeps fresh ones.
update public.matchup_guides set fetched_at = now() - interval '15 days' where enemy_id = 26;
select public.forget_old_matchups();
select is((select array_agg(enemy_id) from public.matchup_guides), array[129], 'cache older than 14 days goes');
select is((select count(*)::integer from cron.job where jobname = 'forget-old-matchups'), 1, 'the cleanup runs daily');

-- Users can't reach any of it.
select tests.sign_in_as('player@example.com');
select throws_ok($$select public.take_matchup_lookup(gen_random_uuid())$$, '42501', null,
  'users cannot take lookups for anyone');
select throws_ok('select 1 from public.matchup_guides', '42501', null, 'users cannot read the cache');

select * from finish();
rollback;
