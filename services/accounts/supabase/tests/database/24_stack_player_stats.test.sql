begin;
\ir _helpers.psql
select plan(16);

select tests.create_user('own@example.com') as own \gset
select tests.create_user('mgr@example.com') as mgr \gset
select tests.create_user('pal@example.com') as pal \gset
select tests.create_user('ask@example.com') as ask \gset
select tests.create_user('inv@example.com') as inv \gset
select tests.create_user('out@example.com') as out \gset
update public.profiles set rank_tier = 54, hero_stats = '{"8": {"games": 10, "wins": 6}}' where id = :'pal';
insert into public.favorite_positions (user_id, position) values (:'pal', 3), (:'pal', 1);
insert into public.favorite_heroes (user_id, position, hero_id, created_at) values
  (:'pal', 1, 8, now() - interval '2 days'), (:'pal', 1, 1, now() - interval '1 day'), (:'pal', 3, 2, now()),
  (:'own', 2, 11, now());
-- pal's last 20 games: 15 at Pos 2, 3 at Pos 4, 2 with no known position; 5 older Pos 1 games fall outside.
insert into public.player_game_facts (user_id, match_id, hero_id, position, is_win, started_at, duration_s)
select :'pal', n, 1, case when n <= 15 then 2 when n <= 18 then 4 when n <= 20 then null else 1 end, true,
  now() - n * interval '1 hour', 2400
from generate_series(1, 25) n;

insert into public.teams (owner_id, name, open_to_requests) values (:'own', 'Night Owls', true) returning id as team \gset
insert into public.team_members (team_id, user_id, role, joined_at) values
  (:'team', :'mgr', 'co_captain', now() - interval '2 days'), (:'team', :'pal', 'player', now() - interval '1 day');
-- Not members: an open join request and a friend invite, one pending and one declined.
insert into public.team_join_requests (team_id, user_id, status) values (:'team', :'ask', 'pending');
insert into public.team_invites (team_id, user_id) values (:'team', :'inv');
insert into public.team_invites (team_id, user_id, declined_at) values (:'team', :'out', now());
-- A second Stack where the Manager is only a player.
insert into public.teams (owner_id, name) values (:'pal', 'Duo') returning id as duo \gset
insert into public.team_members (team_id, user_id) values (:'duo', :'mgr');

select tests.sign_in_as('own@example.com');
select results_eq(format('select user_id from public.stack_player_stats(%L)', :'team'),
  array[:'own', :'mgr', :'pal']::uuid[], 'the owner gets themselves, then members in the order they joined');
select is((select favorites from public.stack_player_stats(:'team') where user_id = :'pal'), '{"1": [8, 1], "3": [2]}'::jsonb,
  'favorites per position, in the order they were added');
select is((select positions from public.stack_player_stats(:'team') where user_id = :'pal'), array[1, 3]::smallint[],
  'positions come sorted');
select is((select hero_stats -> '8' ->> 'games' from public.stack_player_stats(:'team') where user_id = :'pal'), '10',
  'match stats come along');
select is((select rank_tier from public.stack_player_stats(:'team') where user_id = :'pal'), 54::smallint, 'rank comes along');
select is((select played from public.stack_player_stats(:'team') where user_id = :'pal'), '{"2": 15, "4": 3}'::jsonb,
  'played counts positions over the last 20 games only, without unknown ones');
select is((select played from public.stack_player_stats(:'team') where user_id = :'mgr'), '{}'::jsonb,
  'a player with no games has nothing played');
select is_empty(format('select 1 from public.stack_player_stats(%L) where user_id in (%L, %L, %L)', :'team', :'ask', :'inv', :'out'),
  'join requests and invites, pending or declined, are not members');
select is_empty(format('select 1 from public.stack_player_stats(%L)', gen_random_uuid()), 'an unknown Stack gives nothing');
select tests.sign_out();

select tests.sign_in_as('mgr@example.com');
select results_eq(format('select user_id from public.stack_player_stats(%L)', :'team'),
  array[:'mgr', :'pal']::uuid[], 'a Manager gets themselves once and the members, never the owner');
select is_empty(format('select 1 from public.stack_player_stats(%L)', :'duo'),
  'being a Manager of one Stack gives nothing for a Stack they only play in');
select tests.sign_out();

select tests.sign_in_as('pal@example.com');
select is_empty(format('select 1 from public.stack_player_stats(%L)', :'team'), 'a plain member gets nothing');
select tests.sign_out();

select tests.sign_in_as('out@example.com');
select is_empty(format('select 1 from public.stack_player_stats(%L)', :'team'), 'an outsider gets nothing');
select tests.sign_out();

select tests.sign_in_anon();
select throws_ok(format('select public.stack_player_stats(%L)', :'team'), '42501', null, 'signed-out visitors cannot call it');
select tests.sign_out();

-- A member who leaves drops out; a Manager made a player can no longer plan.
delete from public.team_members where team_id = :'team' and user_id = :'pal';
update public.team_members set role = 'player' where team_id = :'team' and user_id = :'mgr';
select tests.sign_in_as('own@example.com');
select results_eq(format('select user_id from public.stack_player_stats(%L)', :'team'),
  array[:'own', :'mgr']::uuid[], 'a member who left drops out');
select tests.sign_out();
select tests.sign_in_as('mgr@example.com');
select is_empty(format('select 1 from public.stack_player_stats(%L)', :'team'), 'a Manager made a player can no longer plan');
select tests.sign_out();

select * from finish();
rollback;
