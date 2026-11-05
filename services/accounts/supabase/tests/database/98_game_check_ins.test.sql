begin;
\ir _helpers.psql
select plan(17);

select tests.create_user('solo@example.com') as solo \gset
select tests.create_user('lead@example.com') as lead \gset
select tests.create_user('pal@example.com') as pal \gset
select tests.create_user('stranger@example.com') as stranger \gset

-- A solo board.
select tests.sign_in_as('solo@example.com');
select public.save_game_check_in(
  'a0000000-0000-4000-8000-000000000001', null,
  '{1,2,3,4,5}', '{1,2,0,4,5}', '{6,7,8,9,10}', '{11,12}', 2::smallint, 2::smallint, '{2,13,14}', true
) as solo_row \gset
select results_eq(
  format('select allies::int[], ally_positions::int[], enemies::int[], bans::int[], my_hero::int, shown::int[], story_shown from public.game_check_ins where id = %L', :'solo_row'),
  $$values ('{1,2,3,4,5}'::int[], '{1,2,0,4,5}'::int[], '{6,7,8,9,10}'::int[], '{11,12}'::int[], 2, '{2,13,14}'::int[], true)$$,
  'a solo board is saved with every list');

select is(
  public.save_game_check_in(
    'a0000000-0000-4000-8000-000000000001', null,
    '{1,2,3,4,15}', null, '{6,7,8,9,10}', null, 2::smallint, null, null, false
  ),
  :'solo_row'::uuid,
  'editing the same board updates the same row');
select results_eq(
  format('select allies::int[], ally_positions::int[], my_hero, story_shown from public.game_check_ins where id = %L', :'solo_row'),
  $$values ('{1,2,3,4,15}'::int[], '{0,0,0,0,0}'::int[], null::smallint, true)$$,
  'the edit replaces the lists, and a Story once shown stays shown');

select throws_ok(
  $$select public.save_game_check_in('a0000000-0000-4000-8000-000000000002', null, '{1,2,3,4}', null, '{6,7,8,9,10}', null, 1::smallint, null, null, false)$$,
  '22023', 'Enter all 10 heroes first', 'a board needs all 10 heroes');
select throws_ok(
  $$select public.save_game_check_in('a0000000-0000-4000-8000-000000000002', null, '{1,2,3,4,5}', null, '{5,7,8,9,10}', null, 1::smallint, null, null, false)$$,
  '22023', 'A hero can be in the draft only once', 'a hero cannot be on both sides');
select throws_ok(
  $$select public.save_game_check_in('a0000000-0000-4000-8000-000000000002', null, '{1,2,3,4,5}', null, '{6,7,8,9,10}', '{1}', 1::smallint, null, null, false)$$,
  '22023', 'A hero can be in the draft only once', 'a picked hero cannot be banned');
select throws_ok(
  $$select public.save_game_check_in('a0000000-0000-4000-8000-000000000002', null, '{1,2,3,4,5}', null, '{6,7,8,9,10}', null, 1::smallint, 6::smallint, null, false)$$,
  '22023', 'Your hero must be on your team', 'my hero is one of ours');
select throws_ok(
  $$select public.save_game_check_in('a0000000-0000-4000-8000-000000000002', null, '{1,2,3,4,null}', null, '{6,7,8,9,10}', null, 1::smallint, null, null, false)$$,
  '23514', null, 'a missing hero is refused');
select throws_ok(
  'insert into public.game_check_ins (user_id, client_key, allies, ally_positions, enemies, my_position) values (auth.uid(), gen_random_uuid(), ''{1,2,3,4,5}'', ''{0,0,0,0,0}'', ''{6,7,8,9,10}'', 1)',
  '42501', null, 'the table cannot be written directly');

-- An answered row is final.
reset role;
update public.game_check_ins set answered_at = now() where id = :'solo_row';
select tests.sign_in_as('solo@example.com');
select throws_ok(
  $$select public.save_game_check_in('a0000000-0000-4000-8000-000000000001', null, '{1,2,3,4,5}', null, '{6,7,8,9,10}', null, 2::smallint, null, null, false)$$,
  '55000', null, 'an answered game cannot be changed');

-- At most 30 new boards a day.
reset role;
insert into public.game_check_ins (user_id, client_key, allies, ally_positions, enemies, my_position)
select :'solo', gen_random_uuid(), '{1,2,3,4,5}', '{0,0,0,0,0}', '{6,7,8,9,10}', 1 from generate_series(1, 29);
select tests.sign_in_as('solo@example.com');
select throws_ok(
  $$select public.save_game_check_in('a0000000-0000-4000-8000-000000000003', null, '{1,2,3,4,5}', null, '{6,7,8,9,10}', null, 1::smallint, null, null, false)$$,
  '54000', null, 'the 31st board of the day is refused');

-- A party board takes its lists from the shared draft.
select tests.sign_out();
reset role;
insert into public.friendships (requester_id, addressee_id, status) values (:'lead', :'pal', 'accepted');
select tests.sign_in_as('lead@example.com');
select public.start_party() as party \gset
select public.invite_to_party(:'pal');
select tests.sign_out();
select tests.sign_in_as('pal@example.com');
select public.answer_party_invite(:'party', true);
select tests.sign_out();
select tests.sign_in_as('lead@example.com');
select public.start_party_draft() as draft \gset
select public.add_draft_action(:'draft', 'ally', h::smallint, case when h = 21 then 3::smallint end) from generate_series(21, 25) h;
select public.add_draft_action(:'draft', 'enemy', h::smallint) from generate_series(31, 35) h;
select public.add_draft_action(:'draft', 'ban', 40::smallint);
select public.save_draft_suggestions(:'draft', 3::smallint, '{21,26}', '{2,1}');
select public.save_game_check_in(
  null, :'draft', '{1,2,3,4,5}', null, '{6,7,8,9,10}', '{11}', 3::smallint, 21::smallint, '{1}', false
) as party_row \gset
select results_eq(
  format('select allies::int[], ally_positions::int[], enemies::int[], bans::int[], shown::int[] from public.game_check_ins where id = %L', :'party_row'),
  $$values ('{21,22,23,24,25}'::int[], '{3,0,0,0,0}'::int[], '{31,32,33,34,35}'::int[], '{40}'::int[], '{21,26}'::int[])$$,
  'a party board uses the shared draft, not the lists the page sent');
select is(
  public.save_game_check_in(null, :'draft', null, null, null, null, 3::smallint, 22::smallint, null, true),
  :'party_row'::uuid,
  'saving the party board again updates the same row');
select throws_ok(
  format($$select public.save_game_check_in(null, %L, null, null, null, null, 1::smallint, 31::smallint, null, false)$$, :'draft'),
  '22023', 'Your hero must be on your team', 'my party hero is one of ours');

-- A member who can no longer read the draft keeps their row and its heroes.
reset role;
update public.party_drafts set ended_at = now() where id = :'draft';
select tests.sign_in_as('lead@example.com');
select lives_ok(
  format($$select public.save_game_check_in(null, %L, null, null, null, null, 4::smallint, 23::smallint, null, false)$$, :'draft'),
  'a member cut off from the ended draft can still update their own row');
select results_eq(
  format('select allies::int[], my_position::int, my_hero::int from public.game_check_ins where id = %L', :'party_row'),
  $$values ('{21,22,23,24,25}'::int[], 4, 23)$$,
  'their heroes stay as saved');

-- Nobody else sees or saves it.
select tests.sign_out();
select tests.sign_in_as('stranger@example.com');
select throws_ok(
  format($$select public.save_game_check_in(null, %L, null, null, null, null, 1::smallint, null, null, false)$$, :'draft'),
  'P0002', null, 'someone outside the party cannot save its board');

select * from finish();
rollback;
