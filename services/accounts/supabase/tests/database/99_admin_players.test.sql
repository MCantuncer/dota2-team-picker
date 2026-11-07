begin;
\ir _helpers.psql
select plan(15);

select tests.create_user('boss@example.com', 'admin') as boss \gset
select tests.create_user('new@example.com') as new \gset
select tests.create_user('old@example.com') as old \gset
select tests.create_user('nosteam@example.com') as nosteam \gset

-- Today in Turkey time, so the counts don't depend on the test runner's clock or time zone.
select (now() at time zone 'Europe/Istanbul')::date as today \gset

update public.profiles set steam_id = '76561198000000001', created_at = (:'today'::date - 20)::timestamp at time zone 'Europe/Istanbul'
  where id = :'boss';
update public.profiles set steam_id = '76561198000000002', created_at = (:'today'::date - 3 + time '10:00') at time zone 'Europe/Istanbul',
  display_name = 'Old', rank_tier = 54 where id = :'old';
-- 00:30 Turkey time today: still yesterday in UTC, so this checks the Turkey day boundary.
update public.profiles set steam_id = '76561198000000003', created_at = (:'today'::date + time '00:30') at time zone 'Europe/Istanbul',
  display_name = 'New' where id = :'new';
-- Not linked to Steam: never counted.
update public.profiles set created_at = now() where id = :'nosteam';

insert into public.favorite_heroes (user_id, position, hero_id) values (:'new', 1, 1), (:'new', 2, 1), (:'new', 2, 74);

-- Only admins.
select tests.sign_in_anon();
select throws_ok('select * from public.admin_signup_stats()', '42501', null, 'a visitor cannot see the numbers');
select throws_ok('select * from public.admin_newest_players()', '42501', null, 'a visitor cannot list players');
select tests.sign_out();
select tests.sign_in_as('new@example.com');
select throws_ok('select * from public.admin_signup_stats()', '42501', null, 'a player cannot see the numbers');
select throws_ok('select * from public.admin_newest_players()', '42501', null, 'a player cannot list players');
select tests.sign_out();

select tests.sign_in_as('boss@example.com');
select is((select total from public.admin_signup_stats()), 3, 'every Steam player counts once');
select is((select today from public.admin_signup_stats()), 1, 'today is counted in Turkey time');
select is((select last_7_days from public.admin_signup_stats()), 2, 'the last 7 days include today');
select is((select first_day from public.admin_signup_stats()), :'today'::date - 13, 'the chart starts 13 days ago');
select is((select per_day from public.admin_signup_stats()),
  array[0,0,0,0,0,0,0,0,0,0,1,0,0,1], 'one count per day, oldest first, ending today');

select results_eq('select user_id from public.admin_newest_players()',
  format('values (%L::uuid), (%L::uuid), (%L::uuid)', :'new', :'old', :'boss'), 'newest first, Steam players only');
select is((select hero_count from public.admin_newest_players() where user_id = :'new'), 2,
  'a hero in two positions counts once');
select results_eq(
  format('select user_id from public.admin_newest_players(1, %L, %L)',
    (select created_at from public.profiles where id = :'new'), :'new'),
  format('values (%L::uuid)', :'old'), 'the next page starts after the last row');
select throws_ok('select * from public.admin_newest_players(0)', '22023', null, 'a page needs at least one row');
select throws_ok('select * from public.admin_newest_players(51)', '22023', null, 'a page has at most 50 rows');
select throws_ok(format('select * from public.admin_newest_players(5, %L)', now()), '22023', null,
  'paging needs both the time and the id');
select tests.sign_out();

select * from finish();
rollback;
