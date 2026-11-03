begin;
\ir _helpers.psql
select plan(7);

select tests.create_user('player@example.com') as player \gset
select tests.create_user('other@example.com') as other \gset

-- The job (service role in production, the test runner here) saves a player's feedback.
insert into public.player_feedback (user_id, version, findings, improved, games, parsed_games, first_game_at, last_game_at)
values (:'player', 1, '[{"kind": "farm"}]', '[]', 6, 4, now() - interval '9 days', now() - interval '1 day');

select throws_ok(
  format($$update public.player_feedback set parsed_games = 7 where user_id = %L$$, :'player'),
  '23514', null, 'parsed games are some of the games');
select throws_ok(
  format($$update public.player_feedback set games = 0, parsed_games = 0 where user_id = %L$$, :'player'),
  '23514', null, 'no games means no game dates');
select throws_ok(
  format($$insert into public.player_game_facts (user_id, match_id, hero_id, is_win, started_at, duration_s, findings)
    values (%L, 8100000001, 114, true, now(), 2400, '{}')$$, :'player'),
  '23514', null, 'a game''s findings are a list');

-- Players read only their own feedback and change nothing directly.
select tests.sign_in_as('player@example.com');
select is((select count(*)::int from public.player_feedback), 1, 'a player reads their feedback');
select throws_ok(format($$update public.player_feedback set games = 1 where user_id = %L$$, :'player'),
  '42501', null, 'but cannot change it');

select tests.sign_out();
select tests.sign_in_as('other@example.com');
select is_empty('select * from public.player_feedback', 'others cannot read it');

-- Deleting the account deletes the feedback.
select tests.sign_out();
delete from auth.users where id = :'player';
select is((select count(*)::int from public.player_feedback), 0, 'feedback goes with the account');

select * from finish();
rollback;
