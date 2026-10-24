begin;
\ir _helpers.psql
select plan(18);

select tests.create_user('cap@example.com', 'captain') as cap \gset
select tests.create_user('ana@example.com') as ana \gset
select tests.create_user('ben@example.com') as ben \gset
select tests.create_user('out@example.com') as out \gset

insert into public.teams (owner_id, name) values (:'cap', 'Radiant') returning id as team \gset
insert into public.team_members (team_id, user_id) values (:'team', :'ana'), (:'team', :'ben');

select isnt((select friend_code from public.profiles where id = :'ana'),
  (select friend_code from public.profiles where id = :'ben'), 'every player gets their own friend code');

-- Suggestions come from shared teams, never from outside them.
select tests.sign_in_as('ana@example.com');
select set_eq('select user_id from public.friend_suggestions()', array[:'cap'::uuid, :'ben'::uuid],
  'suggestions are the owner and members of your teams');

select is(public.send_friend_request(:'ben'), 'pending', 'a new request is pending');
select is(public.send_friend_request(:'ben'), 'pending', 'sending it again changes nothing');
select throws_ok(format('select public.send_friend_request(%L)', :'ana'), '22023', null, 'you cannot add yourself');
select throws_ok(format('select public.accept_friend_request(%L)', :'ben'), 'P0002', null,
  'you cannot accept your own request');
select throws_ok(format('insert into public.friendships (requester_id, addressee_id) values (%L, %L)', :'ana', :'out'),
  '42501', null, 'requests go only through send_friend_request');
select set_eq('select user_id from public.friend_suggestions()', array[:'cap'::uuid],
  'someone you asked is no longer suggested');
select tests.sign_out();

select tests.sign_in_as('out@example.com');
select is_empty('select * from public.friendships', 'other players cannot see the request');
select is((select display_name from public.profile_by_friend_code((select friend_code from public.profiles where id = (select auth.uid())))),
  'out', 'a friend code finds its owner');
select tests.sign_out();

select tests.sign_in_as('ben@example.com');
select results_eq('select incoming from public.my_friends()', array[true], 'the request shows as incoming');
select public.accept_friend_request(:'ana');
select results_eq('select status from public.my_friends()', array['accepted'], 'accepting makes you friends');
select tests.sign_out();

-- A request back to someone who already asked accepts theirs.
select tests.sign_in_as('cap@example.com');
select public.send_friend_request(:'ana');
select tests.sign_out();
select tests.sign_in_as('ana@example.com');
select is(public.send_friend_request(:'cap'), 'accepted', 'asking back accepts the waiting request');
select tests.sign_out();

select tests.sign_in_anon();
select throws_ok('select * from public.my_friends()', '42501', null, 'signed-out visitors cannot list friends');
select throws_ok(format('select * from public.profile_by_friend_code(%L)', (select friend_code from public.profiles where id = :'ana')),
  '42501', null, 'signed-out visitors cannot look up friend codes');
select tests.sign_out();

select tests.sign_in_as('out@example.com');
select is_empty('select * from public.profile_by_friend_code(''not-a-code'')', 'a wrong friend code finds nobody');
delete from public.friendships;
select tests.sign_out();
select is((select count(*)::int from public.friendships), 2, 'other players cannot delete a friendship');

-- Either side can unfriend.
select tests.sign_in_as('ben@example.com');
delete from public.friendships where requester_id = :'ana' and addressee_id = :'ben';
select tests.sign_out();
select is_empty(format('select 1 from public.friendships where requester_id = %L and addressee_id = %L', :'ana', :'ben'),
  'either friend can unfriend');

select * from finish();
rollback;
