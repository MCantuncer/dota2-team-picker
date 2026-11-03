begin;
\ir _helpers.psql
select plan(9);

select tests.create_user('player@example.com') as player \gset
select tests.create_user('other@example.com') as other \gset

-- The job (service role in production, the test runner here) saves a game waiting for its parse.
insert into public.player_game_facts (user_id, match_id, hero_id, position, is_win, started_at, duration_s)
values (:'player', 8100000001, 114, 1, true, now() - interval '1 day', 2400);

select throws_ok(
  format($$update public.player_game_facts set status = 'parsed' where user_id = %L$$, :'player'),
  '23514', null, 'a finished game needs its summary');
select throws_ok(
  format($$update public.player_game_facts set summary = '{"matchId": 1}' where user_id = %L$$, :'player'),
  '23514', null, 'a summary needs its version');
select lives_ok(
  format($$update public.player_game_facts set status = 'parsed', summary = '{"matchId": 8100000001}',
    summary_version = 1 where user_id = %L$$, :'player'),
  'a parsed game keeps its versioned summary');
select throws_ok(
  format($$insert into public.player_game_facts (user_id, match_id, hero_id, is_win, started_at, duration_s)
    values (%L, 8100000001, 114, true, now(), 2400)$$, :'player'),
  '23505', null, 'one row per player and match');

-- Players read only their own rows and change nothing directly.
select tests.sign_in_as('player@example.com');
select is((select count(*)::int from public.player_game_facts), 1, 'a player reads their games');
select throws_ok(format($$update public.player_game_facts set is_win = false where user_id = %L$$, :'player'),
  '42501', null, 'but cannot change them');
select throws_ok(format($$delete from public.player_game_facts where user_id = %L$$, :'player'),
  '42501', null, 'or delete them');

select tests.sign_out();
select tests.sign_in_as('other@example.com');
select is_empty('select * from public.player_game_facts', 'others cannot read them');

-- Deleting the account deletes the games.
select tests.sign_out();
delete from auth.users where id = :'player';
select is((select count(*)::int from public.player_game_facts), 0, 'games go with the account');

select * from finish();
rollback;
