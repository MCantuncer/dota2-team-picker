begin;
\ir _helpers.psql
select plan(28);

select tests.create_user('own@example.com') as own \gset
select tests.create_user('co@example.com') as co \gset
select tests.create_user('pal@example.com') as pal \gset
select tests.create_user('ask@example.com') as ask \gset
select tests.create_user('out@example.com') as out \gset

insert into public.friendships (requester_id, addressee_id, status) values
  (:'own', :'pal', 'accepted'), (:'own', :'out', 'pending');
insert into public.favorite_heroes (user_id, position, hero_id) values (:'pal', 1, 8), (:'ask', 2, 11);

select tests.sign_in_as('own@example.com');
insert into public.teams (owner_id, name) values (:'own', 'Radiant') returning id as team, open_to_requests as open \gset
select tests.sign_out();
select ok(:'open'::boolean, 'a new stack is open to requests');
insert into public.team_members (team_id, user_id, role) values (:'team', :'co', 'co_captain');

-- Friend invites.
select tests.sign_in_as('own@example.com');
select throws_ok(format('select public.invite_friend_to_team(%L, %L)', :'team', :'out'), '42501', null,
  'only accepted friends can be invited');
select public.invite_friend_to_team(:'team', :'pal') as invite \gset
select is(public.invite_friend_to_team(:'team', :'pal'), :'invite'::uuid, 'inviting again keeps the open invite');
select is_empty('select hero_id from public.favorite_heroes where user_id <> auth.uid()',
  'nothing of the friend is readable before they accept');
select tests.sign_out();

select tests.sign_in_as('out@example.com');
select throws_ok(format('select public.answer_team_invite(%L, true)', :'invite'), 'P0002', null,
  'a stranger cannot answer a friend invite');
select throws_ok(format('select public.accept_team_invite(%L)', :'invite'), 'P0002', null,
  'a friend invite cannot be accepted as an email invite');
select is_empty(format('select 1 from public.team_invites where id = %L', :'invite'), 'a stranger cannot see the invite');
select tests.sign_out();

select tests.sign_in_anon();
select is_empty(format('select * from public.get_team_invite(%L)', :'invite'), 'the join page does not show friend invites');
select tests.sign_out();

select tests.sign_in_as('pal@example.com');
select is((select count(*)::int from public.team_invites), 1, 'the invitee sees their own invite');
select is((select team_name from public.my_team_invites()), 'Radiant', 'the invitee lists their open invite');
select is(public.answer_team_invite(:'invite', true), :'team'::uuid, 'the invitee joins');
select throws_ok(format('select public.answer_team_invite(%L, false)', :'invite'), '23505', null,
  'an answered invite cannot be answered again');
select is_empty('select 1 from public.my_team_invites()', 'an answered invite is no longer listed');
select tests.sign_out();

select tests.sign_in_as('own@example.com');
select results_eq('select hero_id from public.favorite_heroes where user_id <> auth.uid()', array[8::smallint],
  'after joining, the owner reads the friend''s heroes');
select throws_ok(format('select public.invite_friend_to_team(%L, %L)', :'team', :'pal'), '23505', null,
  'a member cannot be invited again');
select tests.sign_out();

-- Ask to Join.
select tests.sign_in_as('ask@example.com');
select public.ask_to_join_team(:'team') as req \gset
select throws_ok(format('select public.ask_to_join_team(%L)', :'team'), '23505', null, 'one open request per stack');
select is((select count(*)::int from public.team_join_requests), 1, 'the asker sees their own request');
select throws_ok(format('select public.answer_join_request(%L, true)', :'req'), 'P0002', null,
  'the asker cannot accept their own request');
select tests.sign_out();

select tests.sign_in_as('pal@example.com');
select is_empty('select 1 from public.team_join_requests', 'a plain member does not see requests');
select is_empty(format('select * from public.team_join_requests_for(%L)', :'team'), 'a plain member does not list requests');
select tests.sign_out();

select tests.sign_in_as('co@example.com');
select results_eq(format('select user_id from public.team_join_requests_for(%L)', :'team'), array[:'ask'::uuid],
  'a co-captain lists the request with the asker');
select is((select count(*)::int from public.team_join_requests), 1, 'a co-captain sees the request');
select public.answer_join_request(:'req', false);
select throws_ok(format('select public.answer_join_request(%L, true)', :'req'), '23505', null,
  'a declined request cannot be answered again');
select tests.sign_out();

select tests.sign_in_as('ask@example.com');
select throws_ok(format('select public.ask_to_join_team(%L)', :'team'), '54000', null,
  'asking again within 7 days of a no is refused');
select tests.sign_out();
update public.team_join_requests set answered_at = now() - interval '8 days';

select tests.sign_in_as('ask@example.com');
select public.ask_to_join_team(:'team') as req2 \gset
select tests.sign_out();
select tests.sign_in_as('own@example.com');
select lives_ok(format('select public.answer_join_request(%L, true)', :'req2'), 'the owner accepts');
select results_eq(format('select hero_id from public.favorite_heroes where user_id = %L', :'ask'), array[11::smallint],
  'after acceptance, the owner reads the new member''s heroes');
select tests.sign_out();

-- Closed stacks and the daily cap.
update public.teams set open_to_requests = false where id = :'team';
select tests.sign_in_as('out@example.com');
select throws_ok(format('select public.ask_to_join_team(%L)', :'team'), 'P0002', null, 'a closed stack takes no requests');
select tests.sign_out();
update public.teams set open_to_requests = true where id = :'team';
insert into public.team_join_requests (team_id, user_id, status)
  select :'team', :'out', 'cancelled' from generate_series(1, 20);
select tests.sign_in_as('out@example.com');
select throws_ok(format('select public.ask_to_join_team(%L)', :'team'), '54000', null, 'a user asks 20 stacks a day at most');
select tests.sign_out();

select * from finish();
rollback;
