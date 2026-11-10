begin;
\ir _helpers.psql
select plan(9);

select tests.create_user('boss@example.com', 'admin') as boss \gset
select tests.create_user('lead@example.com') as lead \gset
select tests.create_user('pal@example.com') as pal \gset

insert into public.friendships (requester_id, addressee_id, status) values (:'lead', :'pal', 'accepted');
-- pal's own Pos 5 hero is 5. pal played hero 30 twelve times, hero 31 nine times and hero 32 has a broken count.
insert into public.favorite_heroes (user_id, position, hero_id) values (:'pal', 5, 5), (:'lead', 2, 40);
update public.profiles set hero_stats = '{"30": {"games": 12, "wins": 7}, "31": {"games": 9, "wins": 6}, "32": {"games": "many"}}'
where id = :'pal';

select tests.sign_in_as('lead@example.com');
select public.start_party() as party \gset
select public.invite_to_party(:'pal');
select tests.sign_out();
select tests.sign_in_as('pal@example.com');
select public.answer_party_invite(:'party', true);
select public.start_party_draft() as draft \gset

select lives_ok(format($$select public.save_draft_suggestions(%L, 5::smallint, '{30,5}', '{3,2}', null, 'played')$$, :'draft'),
  'a played list saves');
reset role;
select results_eq(format('select list_rule, outside::int[] from public.draft_suggestions where draft_id = %L', :'draft'),
  $$values ('played'::text, '{}'::int[])$$, 'a hero played 10 or more games is allowed on a played list');

select tests.sign_in_as('pal@example.com');
select public.save_draft_suggestions(:'draft', 5::smallint, '{31,30,32,74,5}', '{5,4,3,2,1}', null, 'played');
reset role;
select results_eq(format('select outside::int[] from public.draft_suggestions where draft_id = %L', :'draft'),
  $$values ('{31,32,74}'::int[])$$, 'under 10 games, a broken count or never played are outside, in the order shown');

select tests.sign_in_as('pal@example.com');
select public.save_draft_suggestions(:'draft', 5::smallint, '{30,5}', '{2,1}', null, 'pool');
reset role;
select results_eq(format('select outside::int[] from public.draft_suggestions where draft_id = %L', :'draft'),
  $$values ('{30}'::int[])$$, 'a pool list still allows only the pool');

-- pal ends on a played list with a slip; lead saves a clean pool list.
select tests.sign_in_as('pal@example.com');
select public.save_draft_suggestions(:'draft', 5::smallint, '{74,30}', '{2,1}', null, 'played');
select tests.sign_out();
select tests.sign_in_as('lead@example.com');
select public.save_draft_suggestions(:'draft', 2::smallint, '{40}', '{1}', null, 'pool');
select throws_ok('select * from public.admin_pool_check()', '42501', null, 'a player still cannot see the pool check');
select tests.sign_out();

select tests.sign_in_anon();
select throws_ok('select * from public.admin_pool_check()', '42501', null, 'anon cannot run the remade pool check');
select tests.sign_out();

select tests.sign_in_as('boss@example.com');
select results_eq('select lists, pool_lists, played_lists, slips, any_lists, unknown_lists, players from public.admin_pool_check()',
  $$values (2, 1, 1, 1, 0, 0, 2)$$, 'played lists are counted, and their slips with the pool ones');
select results_eq('select user_id, outside::int[] from public.admin_pool_slips()',
  format($$values (%L::uuid, '{74}'::int[])$$, :'pal'), 'a played list slip is listed');
select throws_ok('select * from public.admin_pool_check(0)', '22023', null, 'the remade check still limits the days');
select tests.sign_out();

select * from finish();
rollback;
