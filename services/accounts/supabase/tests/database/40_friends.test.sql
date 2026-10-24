begin;
\ir _helpers.psql
select plan(14);

select tests.create_user('ana@example.com') as ana \gset
select tests.create_user('ben@example.com') as ben \gset
select tests.create_user('cem@example.com') as cem \gset
select friend_code as ben_code from public.profiles where id = :'ben' \gset

-- Requests go through the functions only.
select tests.sign_in_as('ana@example.com');
select throws_ok(format('insert into public.friendships (requester_id, addressee_id) values (%L, %L)', :'ana', :'ben'),
  '42501', null, 'users cannot write friendships directly');
select is((select id from public.profile_by_friend_code(:'ben_code')), :'ben'::uuid, 'an add-me code finds its owner');
select is_empty('select * from public.profile_by_friend_code(''not-a-code'')', 'a wrong code finds nobody');
select throws_ok(format('select public.send_friend_request(%L)', :'ana'), '22023', null, 'users cannot add themselves');
select is(public.send_friend_request(:'ben'), 'pending', 'a request starts pending');
select is(public.send_friend_request(:'ben'), 'pending', 'sending twice changes nothing');
select throws_ok(format('select public.accept_friend_request(%L)', :'ben'),
  'P0002', null, 'the requester cannot accept their own request');
select tests.sign_out();

-- Others can't see or touch it.
select tests.sign_in_as('cem@example.com');
select is_empty('select * from public.friendships', 'outsiders cannot see a friendship');
delete from public.friendships;
select is_empty('select * from public.my_friends()', 'outsiders get no friends from it');
select tests.sign_out();
select is((select count(*)::int from public.friendships), 1, 'outsiders cannot delete a friendship');

-- The addressee accepts.
select tests.sign_in_as('ben@example.com');
select lives_ok(format('select public.accept_friend_request(%L)', :'ana'), 'the addressee can accept');
select results_eq('select user_id, status, incoming from public.my_friends()',
  format('values (%L::uuid, %L, true)', :'ana', 'accepted'), 'both see the friendship as accepted');
delete from public.friendships where requester_id = :'ana';
select is_empty('select * from public.friendships', 'either side can unfriend');
select tests.sign_out();

-- Anonymous visitors can't use the add-me lookup.
select tests.sign_in_anon();
select throws_ok(format('select * from public.profile_by_friend_code(%L)', :'ben_code'),
  '42501', null, 'signed-out visitors cannot look up add-me codes');

select * from finish();
rollback;
