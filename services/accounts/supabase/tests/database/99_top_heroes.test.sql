begin;
\ir _helpers.psql
select plan(33);

select tests.create_user('top@example.com') as top \gset
select tests.create_user('else@example.com') as other \gset

-- A pick as the edge function sends it.
create function pg_temp.pick(pos int, hero int)
returns jsonb language sql as $$
  select jsonb_build_object('position', pos, 'hero_id', hero, 'kind', 'regular', 'games', 20, 'wins', 10,
    'strong_games', 3, 'judged_games', 20, 'last_played', 1793900000, 'games_needed', 8)
$$;

-- Who can call it.
select ok(not has_function_privilege('anon', 'public.set_top_hero(smallint, smallint, boolean, smallint)', 'execute'),
  'a visitor cannot change a Top 3');
select ok(has_function_privilege('authenticated', 'public.set_top_hero(smallint, smallint, boolean, smallint)', 'execute'),
  'a signed-in player can');
select ok(not has_function_privilege('authenticated', 'public.top_heroes(uuid, smallint)', 'execute'),
  'a player cannot read anyone''s Top 3 through the helper');

-- The other player's Mid list, starred by them, stays out of every change below.
select tests.sign_in_as('else@example.com');
select public.set_favorite_hero(2::smallint, 11::smallint, true);
select public.set_top_hero(2::smallint, 11::smallint, true);

select tests.sign_out();
select tests.sign_in_as('top@example.com');
select public.set_favorite_hero(2::smallint, h::smallint, true) from unnest(array[74, 11, 13, 76, 14]) h;

-- Bad calls.
select throws_ok('select public.set_top_hero(0::smallint, 74::smallint, true)', '22023', null,
  'Pos 0 has no Top 3');
select throws_ok('select public.set_top_hero(6::smallint, 74::smallint, true)', '22023', null, 'only positions 1 to 5');
select throws_ok('select public.set_top_hero(2::smallint, 86::smallint, true)', '22023', null,
  'a hero not in the list cannot be starred');
select throws_ok(format($$insert into public.favorite_heroes (user_id, position, hero_id, top_slot) values (%L, 1, 2, 1)$$, :'top'),
  '42501', null, 'a player cannot write a slot directly');
select throws_ok('update public.favorite_heroes set top_slot = 1 where position = 2 and hero_id = 74', '42501', null,
  'a player cannot change a slot directly');

-- Filling the Top 3.
select is(public.set_top_hero(2::smallint, 74::smallint, true),
  '{"position": 2, "top": [74]}'::jsonb, 'the first star returns the Top 3');
select is(public.set_top_hero(2::smallint, 11::smallint, true) -> 'top', '[74, 11]'::jsonb, 'the second goes after it');
select is(public.set_top_hero(2::smallint, 13::smallint, true) -> 'top', '[74, 11, 13]'::jsonb, 'the third fills it');
select throws_ok('select public.set_top_hero(2::smallint, 76::smallint, true)', 'P0001', 'top_full',
  'a fourth needs a hero to replace');
select is(public.set_top_hero(2::smallint, 11::smallint, true) -> 'top', '[74, 11, 13]'::jsonb,
  'starring a starred hero again changes nothing, even with the Top 3 full');

-- Replace.
select throws_ok('select public.set_top_hero(2::smallint, 76::smallint, true, 14::smallint)', '22023', null,
  'only a Top 3 hero can be replaced');
select throws_ok('select public.set_top_hero(2::smallint, 76::smallint, false, 11::smallint)', '22023', null,
  'replace only goes with adding');
select throws_ok('select public.set_top_hero(2::smallint, 76::smallint, true, 76::smallint)', '22023', null,
  'a hero cannot replace itself');
select throws_ok('select public.set_top_hero(2::smallint, 86::smallint, true, 11::smallint)', '22023', null,
  'replacing with a hero not in the list fails');
select tests.sign_out();
select is(public.top_heroes(:'top', 2::smallint), '[74, 11, 13]'::jsonb, 'a failed replace changes nothing');
select tests.sign_in_as('top@example.com');
select is(public.set_top_hero(2::smallint, 76::smallint, true, 11::smallint) -> 'top', '[74, 76, 13]'::jsonb,
  'replace swaps in one step and keeps the slot');

-- Removing a star frees its slot for the next one.
select is(public.set_top_hero(2::smallint, 74::smallint, false) -> 'top', '[76, 13]'::jsonb, 'a star comes off');
select is(public.set_top_hero(2::smallint, 74::smallint, false) -> 'top', '[76, 13]'::jsonb,
  'taking off a star that is not there changes nothing');
select is(public.set_top_hero(2::smallint, 14::smallint, true) -> 'top', '[14, 76, 13]'::jsonb,
  'the next star takes the free first slot');

-- Re-adding a listed hero keeps its star; removing the hero takes the star with it.
select public.set_favorite_hero(2::smallint, 14::smallint, true);
select tests.sign_out();
select is(public.top_heroes(:'top', 2::smallint), '[14, 76, 13]'::jsonb, 'adding a starred hero again keeps the star');
select tests.sign_in_as('top@example.com');
select public.set_favorite_hero(2::smallint, 13::smallint, false);
select is((select count(*)::int from public.favorite_heroes where position = 2 and hero_id = 13), 0, 'the hero is gone');
select is(public.set_top_hero(2::smallint, 74::smallint, true) -> 'top', '[14, 76, 74]'::jsonb,
  'its slot is free again');

-- Support Copy: copies start without a star; a starred copy is the player's own and outlives the source.
select public.set_favorite_hero(4::smallint, 26::smallint, true);
select is((select top_slot from public.favorite_heroes where position = 5 and hero_id = 26), null::smallint,
  'a copied hero starts without a star');
select is(public.set_top_hero(5::smallint, 26::smallint, true) -> 'top', '[26]'::jsonb, 'a copied hero can be starred');
select is((select copied_from from public.favorite_heroes where position = 5 and hero_id = 26), null::smallint,
  'starring makes the copy the player''s own');
select public.set_favorite_hero(4::smallint, 26::smallint, false);
select is((select top_slot from public.favorite_heroes where position = 5 and hero_id = 26), 1::smallint,
  'removing it from the source list keeps the starred hero');

-- A fill run over a starred hero keeps the star.
select tests.sign_out();
select public.claim_hero_fill(:'top', 'welcome');
select is(public.save_hero_fill(:'top', 'done', '{2}', jsonb_build_array(pg_temp.pick(2, 14), pg_temp.pick(2, 2)), 50), 1,
  'the fill adds only the new hero');
select is(public.top_heroes(:'top', 2::smallint), '[14, 76, 74]'::jsonb, 'the fill keeps the Top 3');

-- The other player's list was never touched.
select is(public.top_heroes(:'other', 2::smallint), '[11]'::jsonb, 'other players keep their Top 3');

-- The schema itself holds the cap.
select throws_ok(format($$update public.favorite_heroes set top_slot = 1 where user_id = %L and position = 2 and hero_id = 2$$, :'top'),
  '23505', null, 'two heroes cannot share a slot');

select * from finish();
rollback;
