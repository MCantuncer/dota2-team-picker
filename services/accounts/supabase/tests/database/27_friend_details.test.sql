begin;
\ir _helpers.psql
select plan(19);

select tests.create_user('me@example.com') as me \gset
select tests.create_user('pal@example.com') as pal \gset
select tests.create_user('shy@example.com') as shy \gset
select tests.create_user('foe@example.com') as foe \gset
select tests.create_user('ask@example.com') as ask \gset
select tests.create_user('out@example.com') as out \gset
update public.profiles set share_heroes_with_friends = false where id = :'shy';

-- Friends of me: pal (shares), shy (sharing off), foe. ask only asked; out is a stranger.
insert into public.friendships (requester_id, addressee_id, status, accepted_at) values
  (:'me', :'pal', 'accepted', now()), (:'shy', :'me', 'accepted', now()), (:'me', :'foe', 'accepted', now());
insert into public.friendships (requester_id, addressee_id) values (:'ask', :'me');

-- Games: 1 won with pal, 2 lost with pal, 3 foe on the other team, 4 alone, 5 won with shy,
-- 6 with pal but too old, 7 pal alone, 1 again for the stranger.
insert into public.player_games (user_id, match_id, hero_id, position, position_source, is_win, started_at, game_mode, lobby_type)
values
  (:'me', 1, 74, 2, 'draft', true, now() - interval '1 hour', 22, 7),
  (:'pal', 1, 8, 1, 'stratz', true, now() - interval '1 hour', 22, 7),
  (:'out', 1, 5, null, null, true, now() - interval '1 hour', 22, 7),
  (:'me', 2, 13, 2, 'draft', false, now() - interval '1 day', 22, 7),
  (:'pal', 2, 44, null, null, false, now() - interval '1 day', 22, 7),
  (:'me', 3, 74, 2, 'draft', true, now() - interval '2 days', 22, 7),
  (:'foe', 3, 2, 3, 'stratz', false, now() - interval '2 days', 22, 7),
  (:'me', 4, 17, 2, 'draft', true, now() - interval '3 days', 22, 7),
  (:'me', 5, 74, 2, 'draft', true, now() - interval '4 days', 1, 0),
  (:'shy', 5, 128, 4, 'stratz', true, now() - interval '4 days', 1, 0),
  (:'me', 6, 74, 2, 'draft', true, now() - interval '70 days', 22, 7),
  (:'pal', 6, 8, 1, 'stratz', true, now() - interval '70 days', 22, 7),
  (:'pal', 7, 8, 1, 'stratz', true, now() - interval '20 minutes', 22, 7),
  (:'shy', 8, 128, 4, 'stratz', true, now() - interval '10 minutes', 22, 7);

-- me leads a party with pal; foe is in another open party; a closed party with shy doesn't count.
insert into public.parties (leader_id) values (:'me') returning id as mine \gset
insert into public.party_members (party_id, user_id) values (:'mine', :'me'), (:'mine', :'pal');
insert into public.parties (leader_id) values (:'foe') returning id as theirs \gset
insert into public.party_members (party_id, user_id) values (:'theirs', :'foe');
insert into public.parties (leader_id, closed_at) values (:'shy', now()) returning id as closed \gset
insert into public.party_members (party_id, user_id) values (:'closed', :'shy');

select tests.sign_in_as('me@example.com');
select results_eq('select user_id from public.friend_overview() order by user_id',
  format('select unnest(array[%L, %L, %L]::uuid[]) order by 1', :'pal', :'shy', :'foe'),
  'one row per accepted friend, never a pending request or a stranger');
select is((select array[games_together, wins_together] from public.friend_overview() where user_id = :'pal'), array[2, 1],
  'games together count shared matches in the window, with wins');
select is((select last_together from public.friend_overview() where user_id = :'pal'),
  (select started_at from public.player_games where user_id = :'me' and match_id = 1), 'and when you last played together');
select is((select array[games_without, wins_without] from public.friend_overview() where user_id = :'pal'), array[3, 3],
  'your other games in the window, for the win rate without them');
select is((select games_together from public.friend_overview() where user_id = :'foe'), 0,
  'a game on the other team is not together');
select is((select party_state from public.friend_overview() where user_id = :'pal'), 'yours', 'a friend in your party');
select is((select party_size from public.friend_overview() where user_id = :'pal'), 2::smallint, 'with its size');
select is((select party_state from public.friend_overview() where user_id = :'foe'), 'other', 'a friend in another party');
select ok((select party_state is null and party_size is null from public.friend_overview() where user_id = :'shy'),
  'a closed party is no party');
select is((select last_game_at from public.friend_overview() where user_id = :'pal'),
  now() - interval '20 minutes', 'a sharing friend''s last game');
select is((select last_game_at from public.friend_overview() where user_id = :'shy'), null::timestamptz,
  'is hidden when they don''t share with friends');
select is((select games_together from public.friend_overview() where user_id = :'shy'), 1,
  'but games you played together still count');

select results_eq('select match_id from public.games_with_friend(' || quote_literal(:'pal') || ')', array[1, 2]::bigint[],
  'games with a friend, newest first, inside the window');
select is((select array[my_hero_id, friend_hero_id] from public.games_with_friend(:'pal') where match_id = 1),
  array[74, 8]::smallint[], 'with both heroes');
select is((select array[my_position, friend_position] from public.games_with_friend(:'pal') where match_id = 1),
  array[2, 1]::smallint[], 'and positions');
select is_empty(format('select 1 from public.games_with_friend(%L)', :'foe'), 'no games when you were on opposite teams');
select is_empty(format('select 1 from public.games_with_friend(%L)', :'out'), 'a stranger''s games stay hidden');
select is_empty(format('select 1 from public.games_with_friend(%L)', :'ask'), 'and a pending request''s');
select tests.sign_out();

select tests.sign_in_anon();
select throws_ok('select * from public.friend_overview()', '42501', null, 'signed out players cannot call it');
select tests.sign_out();

select * from finish();
rollback;
