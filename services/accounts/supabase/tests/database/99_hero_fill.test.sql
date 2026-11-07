begin;
\ir _helpers.psql
select plan(41);

select tests.create_user('fill@example.com') as fill \gset
select tests.create_user('other@example.com') as other \gset
select tests.create_user('sup4@example.com') as sup4 \gset
select tests.create_user('both@example.com') as both \gset
select tests.create_user('retry@example.com') as retry \gset

-- A pick as the edge function sends it.
create function pg_temp.pick(pos int, hero int, games int default 20, kind text default 'regular')
returns jsonb language sql as $$
  select jsonb_build_object('position', pos, 'hero_id', hero, 'kind', kind, 'games', games, 'wins', games / 2,
    'strong_games', 3, 'judged_games', games, 'last_played', 1793900000,
    'games_needed', case when kind = 'regular' then 8 end)
$$;

-- Only the service role runs a fill.
select tests.sign_in_as('fill@example.com');
select throws_ok(format('select public.claim_hero_fill(%L, %L)', :'fill', 'welcome'), '42501', null,
  'a player cannot claim a fill');
select throws_ok(format('select public.save_hero_fill(%L, %L, %L, %L, 0)', :'fill', 'done', '{1}', '[]'), '42501', null,
  'a player cannot save a fill');
select throws_ok(format('select public.fail_hero_fill(%L)', :'fill'), '42501', null, 'a player cannot fail a fill');
select throws_ok('select public.due_hero_fills(2)', '42501', null, 'a player cannot list due fills');
select throws_ok(format($$insert into public.hero_fill_picks (user_id, position, hero_id, kind, games, wins, strong_games,
  judged_games, last_played) values (%L, 1, 1, 'regular', 1, 1, 0, 0, now())$$, :'fill'),
  '42501', null, 'a player cannot write fill picks');
select tests.sign_out();
select throws_ok(format('select public.claim_hero_fill(%L, %L)', :'fill', 'someone'), '22023', null,
  'only welcome, button or job claim');

-- Claim and save.
select is(public.claim_hero_fill(:'fill', 'welcome'), true, 'a first fill is claimed');
select is((select hero_fill_state from public.profiles where id = :'fill'), 'running', 'the fill is running');
select is(public.claim_hero_fill(:'fill', 'welcome'), false, 'a second claim waits for the running fill');
select is(public.claim_hero_fill(:'fill', 'button'), false, 'the button waits for it too');

-- The player adds Puck themselves and removes Mid's Pudge and the whole Pos 3 before the save lands.
insert into public.favorite_heroes (user_id, position, hero_id) values (:'fill', 2, 13), (:'fill', 2, 14), (:'fill', 3, 2);
insert into public.favorite_positions (user_id, position) values (:'fill', 3);
delete from public.favorite_heroes where user_id = :'fill' and position = 2 and hero_id = 14;
delete from public.favorite_positions where user_id = :'fill' and position = 3;

select is(
  public.save_hero_fill(:'fill', 'done', '{1,2,3}',
    jsonb_build_array(pg_temp.pick(1, 94, 66), pg_temp.pick(1, 70), pg_temp.pick(2, 13), pg_temp.pick(2, 14),
      pg_temp.pick(3, 2), pg_temp.pick(2, 67, 4, 'proven')),
    835),
  3, 'the save adds Medusa, Ursa and the Proven hero');
select results_eq(
  format('select position::int, hero_id::int from public.favorite_heroes where user_id = %L order by position, hero_id', :'fill'),
  $$values (1, 70), (1, 94), (2, 13), (2, 67), (3, 2)$$,
  'removed heroes stay out and nothing is removed');
select results_eq(
  format('select position::int from public.favorite_positions where user_id = %L order by position', :'fill'),
  $$values (1), (2)$$, 'positions are added, except the removed Pos 3');
select results_eq(
  format('select position::int, hero_id::int, kind, games, games_needed from public.hero_fill_picks where user_id = %L order by position, hero_id', :'fill'),
  $$values (1, 70, 'regular', 20, 8), (1, 94, 'regular', 66, 8), (2, 67, 'proven', 4, null::integer)$$,
  'only heroes the fill added carry its numbers; Puck added by hand stays unmarked');
select is((select last_played from public.hero_fill_picks where user_id = :'fill' and hero_id = 94),
  to_timestamp(1793900000), 'last played is saved as a time');
select results_eq(format('select hero_fill_state, hero_fill_games, hero_fill_tries from public.profiles where id = %L', :'fill'),
  $$values ('done', 835, 0::smallint)$$, 'the fill is done with its game count');
select is(public.save_hero_fill(:'fill', 'done', '{1}', '[]', 1), null, 'a save without a running fill does nothing');

-- Players read their own picks only.
select tests.sign_in_as('other@example.com');
select is((select count(*)::int from public.hero_fill_picks), 0, 'a player cannot read another player''s picks');
select tests.sign_out();
select tests.sign_in_as('fill@example.com');
select is((select count(*)::int from public.hero_fill_picks), 3, 'a player reads their own picks');
-- Removing a filled hero removes its reason and is remembered.
select public.set_favorite_hero(1::smallint, 70::smallint, false);
select tests.sign_out();
select is((select count(*)::int from public.hero_fill_picks where user_id = :'fill' and hero_id = 70), 0,
  'removing a filled hero removes its numbers');

-- Fill From My Games: once a day after a fill that finished.
select is(public.claim_hero_fill(:'fill', 'button'), false, 'the button waits a day after a fill');
select is(public.claim_hero_fill(:'fill', 'welcome'), false, 'a welcome visit never runs it again');
update public.profiles set hero_fill_at = now() - interval '25 hours' where id = :'fill';
select is(public.claim_hero_fill(:'fill', 'button'), true, 'the button runs it again a day later');
select is(
  public.save_hero_fill(:'fill', 'done', '{1,2}', jsonb_build_array(pg_temp.pick(1, 94, 70), pg_temp.pick(1, 70)), 840),
  0, 'a second fill adds nothing back');
select is((select games from public.hero_fill_picks where user_id = :'fill' and hero_id = 94), 70,
  'a hero the fill added before gets fresh numbers');

-- No games or too few: the button can try again after 10 minutes.
select public.claim_hero_fill(:'other', 'welcome');
select public.save_hero_fill(:'other', 'no_games', null, null, 0);
select is(public.claim_hero_fill(:'other', 'button'), false, 'right after no games the button waits');
update public.profiles set hero_fill_at = now() - interval '11 minutes' where id = :'other';
select is(public.claim_hero_fill(:'other', 'button'), true, '10 minutes after no games the button runs it');

-- Failures wait and retry with backoff, then stop.
select public.claim_hero_fill(:'retry', 'welcome');
select is(public.fail_hero_fill(:'retry'), 'waiting', 'a failed fill waits');
select ok((select hero_fill_next_at between now() + interval '29 minutes' and now() + interval '31 minutes'
  from public.profiles where id = :'retry'), 'the first retry is in 30 minutes');
select is(public.claim_hero_fill(:'retry', 'job'), false, 'the job waits for the retry time');
update public.profiles set hero_fill_next_at = now() - interval '1 second' where id = :'retry';
select results_eq('select * from public.due_hero_fills(5)', format('values (%L::uuid)', :'retry'), 'a due retry is listed');
select is(public.claim_hero_fill(:'retry', 'welcome'), false, 'a welcome visit does not run a retry');
select is(public.claim_hero_fill(:'retry', 'job'), true, 'the job runs a due retry');
select is((select hero_fill_tries from public.profiles where id = :'retry'), 1::smallint, 'a retry keeps its tries');
-- A run killed before it saves counts as a try once it is 10 minutes old.
update public.profiles set hero_fill_at = now() - interval '11 minutes' where id = :'retry';
select is(public.claim_hero_fill(:'retry', 'job'), false, 'a stuck run is not taken over at once');
select results_eq(format('select hero_fill_state, hero_fill_tries from public.profiles where id = %L', :'retry'),
  $$values ('waiting', 2::smallint)$$, 'a stuck run counts as a failed try');
update public.profiles set hero_fill_state = 'running', hero_fill_tries = 3 where id = :'retry';
select is(public.fail_hero_fill(:'retry'), 'failed', 'the fourth failed try stops the retries');

-- Support Copy: a fill with only Pos 4 heroes copies them to an empty Pos 5.
select public.claim_hero_fill(:'sup4', 'welcome');
select public.save_hero_fill(:'sup4', 'done', '{4}', jsonb_build_array(pg_temp.pick(4, 50), pg_temp.pick(4, 131)), 200);
select results_eq(format('select position::int, hero_id::int, copied_from::int from public.favorite_heroes where user_id = %L order by position, hero_id', :'sup4'),
  $$values (4, 50, null::int), (4, 131, null), (5, 50, 4), (5, 131, 4)$$,
  'Pos 4 heroes from the fill are copied to Pos 5');

-- Real heroes for both support lists: each keeps its own.
select public.claim_hero_fill(:'both', 'welcome');
select public.save_hero_fill(:'both', 'done', '{4,5}', jsonb_build_array(pg_temp.pick(4, 50), pg_temp.pick(5, 26)), 200);
select results_eq(format('select position::int, hero_id::int from public.favorite_heroes where user_id = %L order by position', :'both'),
  $$values (4, 50), (5, 26)$$, 'both support lists keep their own heroes');
select is((select support_copy from public.profiles where id = :'both'), 'off', 'copying never starts');

select lives_ok(format('delete from auth.users where id = %L', :'fill'), 'an account with filled heroes can be deleted');

select * from finish();
rollback;
