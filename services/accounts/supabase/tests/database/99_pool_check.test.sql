begin;
\ir _helpers.psql
select plan(13);

select tests.create_user('boss@example.com', 'admin') as boss \gset
select tests.create_user('lead@example.com') as lead \gset
select tests.create_user('pal@example.com') as pal \gset

insert into public.friendships (requester_id, addressee_id, status) values (:'lead', :'pal', 'accepted');
-- pal plays heroes 5 and 6 at Pos 5, and hero 9 at any position.
insert into public.favorite_heroes (user_id, position, hero_id) values (:'pal', 5, 5), (:'pal', 5, 6), (:'pal', 0, 9), (:'pal', 1, 7);

-- A party of two with an open draft.
select tests.sign_in_as('lead@example.com');
select public.start_party() as party \gset
select public.invite_to_party(:'pal');
select tests.sign_out();
select tests.sign_in_as('pal@example.com');
select public.answer_party_invite(:'party', true);
select public.start_party_draft() as draft \gset

select lives_ok(format($$select public.save_draft_suggestions(%L, 5::smallint, '{6,9,5}', '{3,2,1}', null, 'pool')$$, :'draft'),
  'a pool list saves');
reset role;
select results_eq(format('select list_rule, outside::int[] from public.draft_suggestions where draft_id = %L', :'draft'),
  $$values ('pool'::text, '{}'::int[])$$, 'heroes at the position or at any position are in the pool');

select tests.sign_in_as('pal@example.com');
-- Hero 7 is pal's Pos 1 hero, not Pos 5; 74 is no one's.
select public.save_draft_suggestions(:'draft', 5::smallint, '{74,5,7}', '{3,2,1}', null, 'pool');
reset role;
select results_eq(format('select list_rule, outside::int[] from public.draft_suggestions where draft_id = %L', :'draft'),
  $$values ('pool'::text, '{74,7}'::int[])$$, 'the outside heroes are kept in the order shown');

select tests.sign_in_as('pal@example.com');
select lives_ok(format($$select public.save_draft_suggestions(%L, 5::smallint, '{1,2}', '{1,1}')$$, :'draft'),
  'an older page that sends no rule still saves');
reset role;
select results_eq(format('select list_rule, outside::int[] from public.draft_suggestions where draft_id = %L', :'draft'),
  $$values (null::text, '{1,2}'::int[])$$, 'with no rule, and the outside heroes worked out anyway');
select tests.sign_in_as('pal@example.com');
select throws_ok(format($$select public.save_draft_suggestions(%L, 5::smallint, '{1}', '{1}', null, 'outside')$$, :'draft'),
  '23514', null, 'the rule is pool, played or any');

-- lead saves a pool list with an outsider, then an any list replaces it: one slip from pal only.
select tests.sign_out();
select tests.sign_in_as('lead@example.com');
select public.save_draft_suggestions(:'draft', 2::smallint, '{40}', '{1}', null, 'pool');
select public.save_draft_suggestions(:'draft', 2::smallint, '{40}', '{1}', null, 'any');
select tests.sign_out();
select tests.sign_in_as('pal@example.com');
select public.save_draft_suggestions(:'draft', 5::smallint, '{74,5}', '{2,1}', null, 'pool');

-- Only admins.
select throws_ok('select * from public.admin_pool_check()', '42501', null, 'a player cannot see the pool check');
select throws_ok('select * from public.admin_pool_slips()', '42501', null, 'a player cannot list slips');
select tests.sign_out();

select tests.sign_in_as('boss@example.com');
select results_eq('select lists, pool_lists, slips, any_lists, unknown_lists, players from public.admin_pool_check()',
  $$values (2, 1, 1, 1, 0, 2)$$, 'lists by rule, and the slips among the pool lists');
select results_eq('select user_id, position::int, outside::int[] from public.admin_pool_slips()',
  format($$values (%L::uuid, 5, '{74}'::int[])$$, :'pal'), 'each slip names the player and the outside heroes');
select throws_ok('select * from public.admin_pool_check(0)', '22023', null, 'at least one day');
select throws_ok('select * from public.admin_pool_check(91)', '22023', null, 'at most 90 days');
select throws_ok('select * from public.admin_pool_slips(51)', '22023', null, 'at most 50 slips');
select tests.sign_out();

select * from finish();
rollback;
