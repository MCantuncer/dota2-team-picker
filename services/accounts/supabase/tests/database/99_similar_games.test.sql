begin;
\ir _helpers.psql
select plan(15);

select tests.create_user('player@example.com') as player \gset

-- Caches take only the shapes the function writes.
insert into public.similar_matches (match_id, game) values (9099898435, '{"players":[]}');
select throws_ok($$insert into public.similar_matches (match_id, game) values (1, '[]')$$, '23514', null,
  'a match must be an object');
select throws_ok($$insert into public.similar_matches (match_id, game) values (0, '{}')$$, '23514', null,
  'a match id must be positive');
insert into public.similar_searches (search_key, answer) values ('1795037287:74:2,11,14,26,44:5,8,128,129', '{}');
select throws_ok($$insert into public.similar_searches (search_key, answer) values ('', '{}')$$, '23514', null,
  'a search needs a key');

-- Claims: a key is claimed once, a stale claim can be taken again, bad keys claim nothing.
select is(public.claim_similar_fetches(array['m:1', 'm:2', 'm:2']), array['m:1', 'm:2'], 'new keys are claimed once');
select is(public.claim_similar_fetches(array['m:1', 'm:3']), array['m:3'], 'a key claimed a moment ago is skipped');
update public.similar_claims set claimed_at = now() - interval '2 minutes' where claim_key = 'm:1';
select is(public.claim_similar_fetches(array['m:1']), array['m:1'], 'a stale claim is taken again');
select is(public.claim_similar_fetches(array['', 'x']), '{}'::text[], 'too short keys claim nothing');

-- The hourly limit.
select is((select bool_and(public.take_similar_lookup(:'player', 3)) from generate_series(1, 3)), true,
  'a user gets their lookups');
select is(public.take_similar_lookup(:'player', 3), false, 'one more in the hour is refused');
update public.similar_lookups set looked_up_at = now() - interval '61 minutes';
select is(public.take_similar_lookup(:'player', 3), true, 'lookups older than an hour no longer count');

-- The daily cleanup drops old rows and keeps fresh ones.
insert into public.similar_matches (match_id, game, fetched_at) values (1, '{}', now() - interval '31 days');
update public.similar_searches set fetched_at = now() - interval '3 days';
update public.similar_lookups set looked_up_at = now() - interval '2 days';
select public.forget_old_similar_games();
select is((select array_agg(match_id) from public.similar_matches), array[9099898435::bigint],
  'matches older than 30 days go');
select is((select count(*)::integer from public.similar_searches) + (select count(*)::integer from public.similar_lookups),
  0, 'old searches and lookups go');
select is((select count(*)::integer from cron.job where jobname = 'forget-old-similar-games'), 1,
  'the cleanup runs daily');

-- Users can't reach any of it.
select tests.sign_in_as('player@example.com');
select throws_ok($$select public.take_similar_lookup(gen_random_uuid())$$, '42501', null,
  'users cannot take lookups for anyone');
select throws_ok('select 1 from public.similar_matches', '42501', null, 'users cannot read the cache');

select * from finish();
rollback;
