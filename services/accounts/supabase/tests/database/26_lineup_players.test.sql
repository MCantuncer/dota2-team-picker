begin;
\ir _helpers.psql
select plan(26);

select tests.create_user('own@example.com') as own \gset
select tests.create_user('mgr@example.com') as mgr \gset
select tests.create_user('co@example.com') as co \gset
select tests.create_user('pal@example.com') as pal \gset
select tests.create_user('fri@example.com') as fri \gset
select tests.create_user('shy@example.com') as shy \gset
select tests.create_user('ask@example.com') as ask \gset
select tests.create_user('out@example.com') as out \gset
update public.profiles set display_name = 'Pal', rank_tier = 54, hero_stats = '{"8": {"games": 10, "wins": 6}}' where id = :'pal';
update public.profiles set display_name = 'Fri', rank_tier = 65, hero_stats = '{"2": {"games": 4, "wins": 3}}' where id = :'fri';
update public.profiles set display_name = 'Shy', rank_tier = 71, hero_stats = '{"5": {"games": 9, "wins": 1}}' where id = :'shy';
update public.profiles set display_name = 'Own', rank_tier = 80 where id = :'own';
update public.profiles set display_name = 'Mgr' where id = :'mgr';
update public.profiles set display_name = 'Co' where id = :'co';
insert into public.favorite_positions (user_id, position) values (:'pal', 3), (:'pal', 1), (:'fri', 2), (:'shy', 5), (:'own', 2);
insert into public.favorite_heroes (user_id, position, hero_id, created_at) values
  (:'pal', 1, 8, now() - interval '2 days'), (:'pal', 1, 1, now() - interval '1 day'), (:'pal', 3, 2, now()),
  (:'fri', 2, 11, now()), (:'shy', 5, 50, now()), (:'own', 2, 74, now());

-- Night Owls: owned by own; mgr and co are Managers; pal plays.
insert into public.teams (owner_id, name) values (:'own', 'Night Owls') returning id as team \gset
insert into public.team_members (team_id, user_id, role, joined_at) values
  (:'team', :'mgr', 'co_captain', now() - interval '3 days'), (:'team', :'co', 'co_captain', now() - interval '2 days'),
  (:'team', :'pal', 'player', now() - interval '1 day');
-- Alpha: also owned by own, pal plays here too.
insert into public.teams (owner_id, name) values (:'own', 'Alpha') returning id as alpha \gset
insert into public.team_members (team_id, user_id) values (:'alpha', :'pal');
-- Fri's own Stack, which own does not run: shy plays there.
insert into public.teams (owner_id, name) values (:'fri', 'Elsewhere') returning id as other \gset
insert into public.team_members (team_id, user_id) values (:'other', :'shy');
-- Friends of own: pal (also in Stacks), fri (shares), shy (sharing off). ask only asked.
insert into public.friendships (requester_id, addressee_id, status, accepted_at) values
  (:'own', :'pal', 'accepted', now()), (:'fri', :'own', 'accepted', now()), (:'own', :'shy', 'accepted', now());
insert into public.friendships (requester_id, addressee_id) values (:'ask', :'own');
update public.profiles set share_heroes_with_friends = false where id = :'shy';

select tests.sign_in_as('own@example.com');
select results_eq('select user_id from public.lineup_players()',
  array[:'co', :'fri', :'mgr', :'pal', :'shy']::uuid[], 'Stack members and accepted friends, once each, by name, never the caller');
select is((select favorites from public.lineup_players() where user_id = :'pal'), '{"1": [8, 1], "3": [2]}'::jsonb,
  'a member''s favorites per position, in the order added');
select is((select positions from public.lineup_players() where user_id = :'pal'), array[1, 3]::smallint[], 'positions sorted');
select is((select stacks from public.lineup_players() where user_id = :'pal'),
  jsonb_build_array(
    jsonb_build_object('id', :'alpha'::uuid, 'name', 'Alpha', 'joined_at', (select joined_at from public.team_members where team_id = :'alpha' and user_id = :'pal'), 'role', 'player'),
    jsonb_build_object('id', :'team'::uuid, 'name', 'Night Owls', 'joined_at', (select joined_at from public.team_members where team_id = :'team' and user_id = :'pal'), 'role', 'player')),
  'someone in two Stacks lists both, by name, with ids');
select ok((select is_friend and shared from public.lineup_players() where user_id = :'pal'), 'a Stack mate who is also a friend is marked both');
select is((select favorites from public.lineup_players() where user_id = :'fri'), '{"2": [11]}'::jsonb, 'a friend who shares brings heroes');
select is((select rank_tier from public.lineup_players() where user_id = :'fri'), 65::smallint, 'and rank');
select is((select hero_stats -> '2' ->> 'games' from public.lineup_players() where user_id = :'fri'), '4', 'and hero records');
select is((select stacks from public.lineup_players() where user_id = :'fri'), '[]'::jsonb, 'a friend''s own Stacks never show');
select ok((select not shared and is_friend from public.lineup_players() where user_id = :'shy'), 'a friend who stopped sharing is not shared');
select is((select array[favorites, hero_stats] from public.lineup_players() where user_id = :'shy'), array['{}'::jsonb, '{}'::jsonb],
  'and brings no heroes or records');
select ok((select rank_tier is null and positions = '{}' from public.lineup_players() where user_id = :'shy'), 'and no rank or positions');
select is((select display_name from public.lineup_players() where user_id = :'shy'), 'Shy', 'but keeps their name');
select is_empty(format('select 1 from public.lineup_players() where user_id in (%L, %L)', :'ask', :'out'),
  'a pending request and a stranger never show');
select tests.sign_out();

-- Sharing is one way: turning it off doesn't hide friends who share.
select tests.sign_in_as('own@example.com');
select public.set_share_heroes_with_friends(false);
select is((select favorites from public.lineup_players() where user_id = :'fri'), '{"2": [11]}'::jsonb,
  'turning your own sharing off still shows friends who share');
select tests.sign_out();
select tests.sign_in_as('pal@example.com');
select is((select favorites from public.lineup_players() where user_id = :'own'), '{}'::jsonb, 'and friends no longer get your heroes');
select tests.sign_out();

-- A Manager: the members and the other Manager, and the owner without heroes.
select tests.sign_in_as('mgr@example.com');
select results_eq('select user_id from public.lineup_players()', array[:'co', :'own', :'pal']::uuid[],
  'a Manager gets the members, the other Manager and the owner');
select ok((select not shared and favorites = '{}' and rank_tier is null from public.lineup_players() where user_id = :'own'),
  'the owner''s heroes stay hidden from a Manager');
select is((select stacks -> 0 ->> 'role' from public.lineup_players() where user_id = :'own'), 'owner', 'marked as the owner');
select is((select stacks -> 0 ->> 'role' from public.lineup_players() where user_id = :'co'), 'co_captain', 'the other Manager is marked');
select tests.sign_out();
-- Unless the owner is a friend who shares.
insert into public.friendships (requester_id, addressee_id, status, accepted_at) values (:'mgr', :'own', 'accepted', now());
update public.profiles set share_heroes_with_friends = true where id = :'own';
select tests.sign_in_as('mgr@example.com');
select is((select favorites from public.lineup_players() where user_id = :'own'), '{"2": [74]}'::jsonb,
  'an owner who is a sharing friend brings heroes');
select tests.sign_out();

-- A plain member plans nobody from the Stack.
select tests.sign_in_as('shy@example.com');
select is_empty(format('select 1 from public.lineup_players() where user_id = %L', :'fri'), 'a plain member gets nobody from a Stack they only play in');
select tests.sign_out();

-- An unfriended friend drops out.
delete from public.friendships where requester_id = :'fri' and addressee_id = :'own';
select tests.sign_in_as('own@example.com');
select is_empty(format('select 1 from public.lineup_players() where user_id = %L', :'fri'), 'an unfriended friend drops out');
select throws_ok('select public.set_share_heroes_with_friends(null)', '22023', null, 'the switch needs on or off');
select tests.sign_out();

select tests.sign_in_anon();
select throws_ok('select public.lineup_players()', '42501', null, 'signed-out visitors cannot list players');
select throws_ok('select public.set_share_heroes_with_friends(true)', '42501', null, 'or change the switch');
select tests.sign_out();

select * from finish();
rollback;
