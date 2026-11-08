begin;
\ir _helpers.psql
select plan(9);

select tests.create_user('own@example.com') as own \gset
select tests.create_user('pal@example.com') as pal \gset
select tests.create_user('shy@example.com') as shy \gset
select tests.create_user('new@example.com') as new \gset
insert into public.favorite_heroes (user_id, position, hero_id, created_at, top_slot) values
  (:'pal', 1, 8, now() - interval '2 days', 2), (:'pal', 1, 1, now() - interval '1 day', 1), (:'pal', 3, 2, now(), null),
  (:'shy', 5, 50, now(), 1), (:'new', 2, 74, now(), null);

select ok(not has_function_privilege('authenticated', 'public.top_by_position(uuid)', 'execute'),
  'players cannot read anyone''s Top 5 through the helper');

-- Party: every member's Top 5 next to their favorites.
insert into public.parties (leader_id) values (:'own') returning id as party \gset
insert into public.party_members (party_id, user_id) values (:'party', :'own'), (:'party', :'pal'), (:'party', :'new');
select tests.sign_in_as('own@example.com');
select is((select top from public.party_player_stats() where user_id = :'pal'), '{"1": [1, 8]}'::jsonb,
  'party: a member''s Top 5 per position, in slot order');
select is((select favorites from public.party_player_stats() where user_id = :'pal'), '{"1": [8, 1], "3": [2]}'::jsonb,
  'party: favorites are unchanged');
select is((select top from public.party_player_stats() where user_id = :'new'), '{}'::jsonb,
  'party: no stars is an empty object');
select tests.sign_out();
delete from public.party_members where party_id = :'party';
delete from public.parties where id = :'party';

-- Stack planning: the same for members.
insert into public.teams (owner_id, name) values (:'own', 'Night Owls') returning id as team \gset
insert into public.team_members (team_id, user_id) values (:'team', :'pal');
select tests.sign_in_as('own@example.com');
select is((select top from public.stack_player_stats(:'team') where user_id = :'pal'), '{"1": [1, 8]}'::jsonb,
  'stack: a member''s Top 5 per position');
select is((select top from public.stack_player_stats(:'team') where user_id = :'own'), '{}'::jsonb,
  'stack: the caller without stars gets an empty object');
select tests.sign_out();

-- Mixed lineups: a friend who shares shows their Top 5; one who doesn't share shows none.
insert into public.friendships (requester_id, addressee_id, status, accepted_at) values
  (:'own', :'shy', 'accepted', now());
select tests.sign_in_as('own@example.com');
select is((select top from public.lineup_players() where user_id = :'pal'), '{"1": [1, 8]}'::jsonb,
  'lineup: a Stack member''s Top 5');
select is((select top from public.lineup_players() where user_id = :'shy'), '{"5": [50]}'::jsonb,
  'lineup: a friend who shares shows their Top 5');
select tests.sign_out();
update public.profiles set share_heroes_with_friends = false where id = :'shy';
select tests.sign_in_as('own@example.com');
select is((select top from public.lineup_players() where user_id = :'shy'), '{}'::jsonb,
  'lineup: a friend who does not share shows no Top 5');

select * from finish();
rollback;
