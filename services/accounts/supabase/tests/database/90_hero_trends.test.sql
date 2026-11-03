begin;
\ir _helpers.psql
select plan(17);

select tests.create_user('player@example.com') as player \gset
select tests.create_user('other@example.com') as other \gset

-- The job (service role in production, the test runner here) saves games and opens a card.
insert into public.player_games (user_id, match_id, hero_id, position, position_source, is_win, is_strong, imp,
  started_at, game_mode, lobby_type)
values (:'player', 8100000001, 114, 1, 'stratz', true, true, 31, now() - interval '1 day', 22, 7);
insert into public.pool_suggestions (user_id, hero_id, position, question, reason, evidence)
values (:'player', 114, 1, 'Add Monkey King to your carry heroes?', 'You won 100% of your last 5.', '{"games": 5}')
returning id as card \gset

select throws_ok(
  format($$insert into public.player_games (user_id, match_id, hero_id, position, is_win, started_at, game_mode,
    lobby_type) values (%L, 2, 1, 1, true, now(), 22, 7)$$, :'player'),
  '23514', null, 'a position needs its source');
select throws_ok(
  format($$insert into public.pool_suggestions (user_id, hero_id, position, question, reason, evidence)
    values (%L, 114, 1, 'q', 'r', '{}')$$, :'player'),
  '23505', null, 'one live card per hero and position');
select throws_ok(
  format($$update public.pool_suggestions set status = 'snoozed' where id = %L$$, :'card'),
  '23514', null, 'a snoozed card has a time to come back');
select lives_ok(
  format($$insert into public.pool_suggestions (user_id, hero_id, position, status, question, reason, evidence)
    values (%L, 114, 1, 'declined', 'q', 'r', '{}')$$, :'player'),
  'answered cards stay as history next to a live one');

-- Players read only their own rows and change nothing directly.
select tests.sign_in_as('player@example.com');
select is((select count(*)::int from public.player_games), 1, 'a player reads their games');
select is((select count(*)::int from public.pool_suggestions where status = 'open'), 1, 'and their open card');
select throws_ok(format($$update public.pool_suggestions set status = 'accepted' where id = %L$$, :'card'),
  '42501', null, 'but cannot answer it by writing the row');
select throws_ok(format($$delete from public.player_games where user_id = %L$$, :'player'),
  '42501', null, 'or delete games');
select throws_ok('select * from public.hero_benchmarks', '42501', null, 'benchmarks are for the job only');
select throws_ok('update public.profiles set pool_suggestions_off = true', '42501', null,
  'the stop switch is not a direct write');

select tests.sign_out();
select tests.sign_in_as('other@example.com');
select is_empty('select * from public.player_games', 'others cannot read the games');
select is_empty('select * from public.pool_suggestions', 'or the cards');

-- The budget: a caller with its own cap keeps inside it, and the day's cap still holds for all.
select tests.sign_out();
select is(public.take_opendota_calls(3, 10, 'trends', 4), true, 'a capped caller takes within its share');
select is(public.take_opendota_calls(2, 10, 'trends', 4), false, 'but not past it');
select is(public.take_opendota_calls(7, 10), true, 'other callers use the rest of the day');
select is(public.take_opendota_calls(1, 10, 'trends', 4), false, 'and the day cap stops the capped caller too');

-- Deleting the account deletes the games and cards.
delete from auth.users where id = :'player';
select is((select count(*)::int from public.player_games) + (select count(*)::int from public.pool_suggestions), 0,
  'games and cards go with the account');

select * from finish();
rollback;
