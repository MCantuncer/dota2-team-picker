begin;
\ir _helpers.psql
select plan(29);

select tests.create_user('sup@example.com') as sup \gset
select tests.create_user('five@example.com') as five \gset
select tests.create_user('old@example.com') as old \gset
select tests.create_user('card@example.com') as card \gset
select tests.create_user('gone@example.com') as gone \gset

-- Who can call what.
select tests.sign_in_anon();
select throws_ok('select public.set_favorite_hero(4::smallint, 14::smallint, true)', '42501', null,
  'a visitor cannot change heroes');
select tests.sign_out();
select tests.sign_in_as('sup@example.com');
select throws_ok(format('select public.apply_support_copy(%L, 4::smallint, 14::smallint, true)', :'five'), '42501', null,
  'a player cannot run the copy for anyone');
select throws_ok(format('select public.support_lists(%L)', :'five'), '42501', null,
  'a player cannot read anyone''s support lists');
select throws_ok('select public.set_favorite_hero(6::smallint, 14::smallint, true)', '22023', null, 'only positions 0 to 5');
select throws_ok(format($$insert into public.favorite_heroes (user_id, position, hero_id, copied_from) values (%L, 1, 2, 4)$$, :'sup'),
  '42501', null, 'a player cannot mark their own row as copied');

-- The first support hero starts copying from that list.
select is(public.set_favorite_hero(4::smallint, 14::smallint, true),
  '{"heroes": {"4": [14], "5": [14]}, "support_copy": "on", "support_copy_from": 4}'::jsonb,
  'the first Pos 4 hero is copied to Pos 5 and copying starts');
select is((select copied_from from public.favorite_heroes where position = 5 and hero_id = 14), 4::smallint,
  'the copy is marked as copied from Pos 4');
select is((select count(*)::int from public.favorite_positions where position = 5), 0, 'copying never turns Pos 5 on');
select is(public.set_favorite_hero(4::smallint, 50::smallint, true) -> 'heroes',
  '{"4": [14, 50], "5": [14, 50]}'::jsonb, 'later Pos 4 heroes are copied too');
select is(public.set_favorite_hero(1::smallint, 8::smallint, true) -> 'heroes',
  '{"4": [14, 50], "5": [14, 50]}'::jsonb, 'other positions are not copied');

-- A remove on the source list is copied, and remembered on the source list only.
select is(public.set_favorite_hero(4::smallint, 50::smallint, false) -> 'heroes',
  '{"4": [14], "5": [14]}'::jsonb, 'a Pos 4 removal is copied');
select results_eq('select position, hero_id from public.pool_removals order by position',
  $$values (4::smallint, 50::smallint)$$, 'only the player''s own removal is remembered');
select is((select current_setting('app.support_copy', true)), '', 'the copy flag is reset after each copy');

-- Pos 5 heroes the player removed are never copied back.
select tests.sign_out();
insert into public.pool_removals (user_id, position, hero_id) values (:'sup', 5, 26);
select tests.sign_in_as('sup@example.com');
select is(public.set_favorite_hero(4::smallint, 26::smallint, true) -> 'heroes',
  '{"4": [14, 26], "5": [14]}'::jsonb, 'a hero removed from Pos 5 is not copied back');

-- The first change on Pos 5 ends copying for good; both lists keep their heroes.
select is(public.set_favorite_hero(5::smallint, 14::smallint, false),
  '{"heroes": {"4": [14, 26], "5": []}, "support_copy": "off", "support_copy_from": null}'::jsonb,
  'removing from Pos 5 is the player''s own change and turns copying off');
select is(public.set_favorite_hero(4::smallint, 86::smallint, true) -> 'heroes',
  '{"4": [14, 26, 86], "5": []}'::jsonb, 'after that Pos 4 is not copied');
select is(public.set_favorite_hero(5::smallint, 14::smallint, true) -> 'support_copy', '"off"'::jsonb,
  'copying never starts again');
select is((select count(*)::int from public.pool_removals where position = 5 and hero_id = 14), 0,
  'adding a hero again clears its removal');
select tests.sign_out();

-- Pos 5 can be the source too, and Stop Copying keeps both lists.
select tests.sign_in_as('five@example.com');
select is(public.set_favorite_hero(5::smallint, 5::smallint, true) -> 'heroes', '{"4": [5], "5": [5]}'::jsonb,
  'the first Pos 5 hero is copied to Pos 4');
select is(public.stop_support_copy(),
  '{"heroes": {"4": [5], "5": [5]}, "support_copy": "off", "support_copy_from": null}'::jsonb,
  'Stop Copying keeps both lists and turns copying off');
select is(public.set_favorite_hero(5::smallint, 5::smallint, false) -> 'heroes', '{"4": [5], "5": []}'::jsonb,
  'after Stop Copying a Pos 5 removal stays on Pos 5');
select tests.sign_out();

-- A player who already had support heroes never starts copying.
insert into public.favorite_heroes (user_id, position, hero_id) values (:'old', 5, 5);
select tests.sign_in_as('old@example.com');
select is(public.set_favorite_hero(4::smallint, 14::smallint, true),
  '{"heroes": {"4": [14], "5": [5]}, "support_copy": "off", "support_copy_from": null}'::jsonb,
  'with a Pos 5 hero already there, Pos 4 is not copied');
select tests.sign_out();

-- A Yes on a hero pool card is copied like a hero added by hand.
insert into public.pool_suggestions (user_id, hero_id, position, question, reason, evidence)
values (:'card', 14, 4, 'Add Pudge to your Soft Support heroes?', 'r', '{}') returning id as pudge \gset
select tests.sign_in_as('card@example.com');
select is(public.answer_pool_suggestion(:'pudge', 'yes'), 'accepted', 'the card is accepted');
select results_eq('select position, hero_id, copied_from from public.favorite_heroes order by position',
  $$values (4::smallint, 14::smallint, null::smallint), (5::smallint, 14::smallint, 4::smallint)$$,
  'and its hero is copied to Pos 5');
select tests.sign_out();

-- Removing a position is remembered as hero 0.
select tests.sign_in_as('card@example.com');
delete from public.favorite_positions where position = 4;
select results_eq('select position, hero_id from public.pool_removals', $$values (4::smallint, 0::smallint)$$,
  'a removed position is remembered');
select throws_ok(format('insert into public.pool_removals (user_id, position, hero_id) values (%L, 1, 1)', :'card'),
  '42501', null, 'players cannot write removals');
select tests.sign_out();
select tests.sign_in_as('sup@example.com');
select is_empty(format('select 1 from public.pool_removals where user_id = %L', :'card'), 'players read only their own removals');
select tests.sign_out();

-- Deleting an account with heroes and positions leaves no removals behind.
insert into public.favorite_heroes (user_id, position, hero_id) values (:'gone', 4, 14), (:'gone', 1, 1);
insert into public.favorite_positions (user_id, position) values (:'gone', 4);
select lives_ok(format('delete from auth.users where id = %L', :'gone'), 'an account with heroes can be deleted');
select is_empty(format('select 1 from public.pool_removals where user_id = %L', :'gone'), 'and leaves no removals');

select * from finish();
rollback;
