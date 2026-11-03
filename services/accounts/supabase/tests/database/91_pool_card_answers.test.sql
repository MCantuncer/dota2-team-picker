begin;
\ir _helpers.psql
select plan(18);

select tests.create_user('player@example.com') as player \gset
select tests.create_user('other@example.com') as other \gset

-- Three cards from the job: Monkey King carry, Lion hard support, Pudge soft support.
insert into public.pool_suggestions (user_id, hero_id, position, question, reason, evidence)
values (:'player', 114, 1, 'Add Monkey King to your carry heroes?', 'r', '{}') returning id as mk \gset
insert into public.pool_suggestions (user_id, hero_id, position, question, reason, evidence)
values (:'player', 26, 5, 'Add Lion to your hard support heroes?', 'r', '{}') returning id as lion \gset
insert into public.pool_suggestions (user_id, hero_id, position, question, reason, evidence)
values (:'player', 14, 4, 'Add Pudge to your soft support heroes?', 'r', '{}') returning id as pudge \gset

select tests.sign_in_as('other@example.com');
select throws_ok(format($$select public.answer_pool_suggestion(%L, 'yes')$$, :'mk'), 'P0002', null,
  'nobody else can answer the card');

select tests.sign_out();
select tests.sign_in_as('player@example.com');
select throws_ok(format($$select public.answer_pool_suggestion(%L, 'maybe')$$, :'mk'), '22023', null,
  'only yes, no or later');

-- Yes adds the hero and turns the position on.
select is(public.answer_pool_suggestion(:'mk', 'yes'), 'accepted', 'yes accepts');
select is((select count(*)::int from public.favorite_heroes where hero_id = 114 and position = 1), 1,
  'the hero joins the carry pool');
select is((select count(*)::int from public.favorite_positions where position = 1), 1, 'carry is turned on');
select is(public.answer_pool_suggestion(:'mk', 'no'), 'accepted', 'answering again changes nothing');

-- Later snoozes for 3 days, and a snoozed card can still be answered.
select is(public.answer_pool_suggestion(:'lion', 'later'), 'snoozed', 'later snoozes');
select ok((select snooze_until between now() + interval '71 hours' and now() + interval '73 hours'
  from public.pool_suggestions where id = :'lion'), 'for 3 days');
select is(public.answer_pool_suggestion(:'lion', 'no'), 'declined', 'a snoozed card can be declined');
select is((select snooze_until from public.pool_suggestions where id = :'lion'), null, 'and loses its snooze time');

-- A second No for the same hero and position blocks it.
select tests.sign_out();
insert into public.pool_suggestions (user_id, hero_id, position, question, reason, evidence)
values (:'player', 26, 5, 'Add Lion to your hard support heroes?', 'r', '{}') returning id as lion2 \gset
select tests.sign_in_as('player@example.com');
select is(public.answer_pool_suggestion(:'lion2', 'no'), 'blocked', 'the second No blocks the pair');
select is((select decline_count from public.pool_suggestions where id = :'lion2'), 2::smallint, 'and counts both');

-- The stop switch closes waiting cards.
select lives_ok('select public.set_pool_suggestions_off(true)', 'players can stop the cards');
select is((select pool_suggestions_off from public.profiles where id = :'player'), true, 'the switch is saved');
select is((select status from public.pool_suggestions where id = :'pudge'), 'expired', 'waiting cards close');

-- The activity mark is written at most every 10 minutes.
select public.mark_active();
select tests.sign_out();
update public.profiles set last_active_at = now() - interval '5 minutes' where id = :'player';
select tests.sign_in_as('player@example.com');
select public.mark_active();
select ok((select last_active_at < now() - interval '4 minutes' from public.profiles where id = :'player'),
  'a second mark within 10 minutes writes nothing');
select tests.sign_out();
update public.profiles set last_active_at = now() - interval '11 minutes' where id = :'player';
select tests.sign_in_as('player@example.com');
select public.mark_active();
select ok((select last_active_at > now() - interval '1 minute' from public.profiles where id = :'player'),
  'after 10 minutes it is written again');

select tests.sign_in_anon();
select throws_ok('select public.mark_active()', '42501', null, 'signed out visitors cannot call it');

select * from finish();
rollback;
