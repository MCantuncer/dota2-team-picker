begin;
\ir _helpers.psql
select plan(5);

select tests.create_user('boss@example.com', 'admin') as boss \gset
select tests.create_user('pal@example.com') as pal \gset

-- Hero 8 at Pos 1: one enemy fetched today, one 10 days ago, one going stale tomorrow.
-- Hero 8 at Pos 2 two days ago, and an older game version that the count leaves out.
insert into public.matchup_guides (hero_id, position, enemy_id, game_version, games, fetched_at) values
  (8, 1, 1, 200, '[{}, {}]', now()),
  (8, 1, 2, 200, '[]', now() - interval '10 days'),
  (8, 1, 4, 200, '[]', now() - interval '6 days 12 hours'),
  (8, 2, 1, 200, '[{}]', now() - interval '2 days'),
  (8, 1, 3, 199, '[{}]', now());

select tests.sign_in_as('pal@example.com');
select throws_ok('select * from public.admin_matchup_fill(200)', '42501', null, 'a player cannot see the data status');
select tests.sign_out();

select tests.sign_in_as('boss@example.com');
select results_eq('select hero_id, position::int, slices, fresh, last_day, expiring from public.admin_matchup_fill(200)',
  $$values (8, 1, 3, 2, 1, 1), (8, 2, 1, 1, 0, 0)$$,
  'one row per hero and position: fresh is the last 7 days, last_day the last day, expiring 6 to 7 days ago');
select ok((select max(last_fetched) > now() - interval '1 minute' from public.admin_matchup_fill(200)),
  'the latest fetch is returned');
select is((select count(*)::int from public.admin_matchup_fill(201)), 0, 'another version has no rows');
select throws_ok('select * from public.admin_matchup_fill(0)', '22023', null, 'the version must be above 0');
select tests.sign_out();

select * from finish();
rollback;
