begin;
\ir _helpers.psql
select plan(29);

select tests.create_user('lead@example.com') as lead \gset
select tests.create_user('pal@example.com') as pal \gset
select tests.create_user('stranger@example.com') as stranger \gset
select tests.create_user('other@example.com') as other \gset
select tests.create_user('p4@example.com') as p4 \gset
select tests.create_user('p5@example.com') as p5 \gset
select tests.create_user('p6@example.com') as p6 \gset

insert into public.friendships (requester_id, addressee_id, status) values (:'lead', :'pal', 'accepted');

-- Nobody signed out can use links.
select tests.sign_in_anon();
select throws_ok('select * from public.party_link()', '42501', null, 'signed-out visitors cannot get a link');
select throws_ok($$ select * from public.party_by_link('x') $$, '42501', null, 'signed-out visitors cannot look up a link');
select throws_ok($$ select public.join_party_by_link('x') $$, '42501', null, 'signed-out visitors cannot join by link');
select tests.sign_out();

-- The leader gets one link; asking again keeps it and extends it.
select tests.sign_in_as('lead@example.com');
select throws_ok('select * from public.party_link()', 'P0002', null, 'no party, no link');
select public.start_party() as party \gset
select code as code1, expires_at as exp1 from public.party_link() \gset
select ok(:'code1' ~ '^[0-9a-f]{16}$', 'the code is 16 hex characters');
select tests.sign_out();
update public.party_links set expires_at = now() + interval '1 hour' where party_id = :'party';
select tests.sign_in_as('lead@example.com');
select results_eq('select code from public.party_link()', array[:'code1'], 'asking again keeps the same link');
select ok((select expires_at from public.party_link()) > now() + interval '23 hours', 'asking again keeps it alive for 24 hours');
select public.invite_to_party(:'pal');
select tests.sign_out();

-- The code is never readable directly.
select tests.sign_in_as('lead@example.com');
select throws_ok('select * from public.party_links', '42501', null, 'the leader cannot read the links table');
select throws_ok('select * from public.party_kicks', '42501', null, 'the leader cannot read the kicks table');
select tests.sign_out();

-- A stranger looks it up and joins; their invite to it, if any, closes.
select tests.sign_in_as('stranger@example.com');
select is_empty($$ select * from public.party_by_link('0000000000000000') $$, 'an unknown code shows nothing');
select results_eq(format('select leader_id = %L and members = 1 and not is_member and not is_kicked from public.party_by_link(%L)', :'lead', :'code1'),
  array[true], 'a stranger sees whose party it is');
select is(public.join_party_by_link(:'code1'), :'party'::uuid, 'a stranger joins by link');
select is(public.join_party_by_link(:'code1'), :'party'::uuid, 'joining twice changes nothing');
select is((select count(*)::int from public.party_view()), 2, 'the stranger is in the party once');
select tests.sign_out();

select tests.sign_in_as('pal@example.com');
select public.join_party_by_link(:'code1');
select is_empty('select * from public.my_party_invites()', 'joining by link closes the pending invite to that party');
select tests.sign_out();

-- Only the leader shares the link.
select tests.sign_in_as('pal@example.com');
select throws_ok('select * from public.party_link()', '42501', null, 'a member who is not the leader cannot get the link');
select tests.sign_out();

-- Removed players can't come back by link; a direct invite brings them back.
select tests.sign_in_as('lead@example.com');
select public.remove_from_party(:'pal');
select tests.sign_out();
select tests.sign_in_as('pal@example.com');
select results_eq(format('select is_kicked from public.party_by_link(%L)', :'code1'), array[true], 'a removed player sees they were removed');
select throws_ok(format('select public.join_party_by_link(%L)', :'code1'), '42501', null, 'a removed player cannot rejoin by link');
select tests.sign_out();
select tests.sign_in_as('lead@example.com');
select public.invite_to_party(:'pal');
select tests.sign_out();
select tests.sign_in_as('pal@example.com');
select public.answer_party_invite(:'party', true);
select public.leave_party();
select lives_ok(format('select public.join_party_by_link(%L)', :'code1'), 'invited back, a player who left on their own can use the link again');
select tests.sign_out();

-- Joining by link while leading another party hands that party on.
select tests.sign_in_as('other@example.com');
select public.start_party() as party2 \gset
select tests.sign_out();
select tests.sign_in_as('other@example.com');
select code as code2 from public.party_link() \gset
select tests.sign_out();
select tests.sign_in_as('p4@example.com');
select public.join_party_by_link(:'code2');
select tests.sign_out();
select tests.sign_in_as('other@example.com');
select public.join_party_by_link(:'code1');
select tests.sign_out();
select is((select leader_id from public.parties where id = :'party2'), :'p4'::uuid,
  'leaving a party you lead to join by link hands it to the next member');

-- The party holds five.
select tests.sign_in_as('p5@example.com');
select public.join_party_by_link(:'code1');
select tests.sign_out();
select tests.sign_in_as('p6@example.com');
select throws_ok(format('select public.join_party_by_link(%L)', :'code1'), '54000', null, 'a sixth player cannot join');
select tests.sign_out();

-- A new link replaces the old one at once.
select tests.sign_in_as('lead@example.com');
select code as code3 from public.party_link(true) \gset
select isnt(:'code3'::text, :'code1'::text, 'a new link has a new code');
select tests.sign_out();
select tests.sign_in_as('p6@example.com');
select throws_ok(format('select public.join_party_by_link(%L)', :'code1'), 'P0002', null, 'the old link stops working');
select tests.sign_out();

-- When the leader leaves, the next leader shares the same link.
select tests.sign_in_as('lead@example.com');
select public.leave_party();
select tests.sign_out();
select tests.sign_in_as('stranger@example.com');
select results_eq('select code from public.party_link()', array[:'code3'], 'the new leader gets the same link');
select tests.sign_out();

-- Expired links and closed parties show nothing and can't be joined.
update public.party_links set expires_at = now() - interval '1 second' where party_id = :'party';
select tests.sign_in_as('p6@example.com');
select is_empty(format('select * from public.party_by_link(%L)', :'code3'), 'an expired link shows nothing');
select throws_ok(format('select public.join_party_by_link(%L)', :'code3'), 'P0002', null, 'an expired link cannot be joined');
select tests.sign_out();
update public.party_links set expires_at = now() + interval '1 hour' where party_id = :'party';
update public.parties set closed_at = now() where id = :'party';
select tests.sign_in_as('p6@example.com');
select is_empty(format('select * from public.party_by_link(%L)', :'code3'), 'a closed party''s link shows nothing');
select tests.sign_out();

-- Deleting an account while signed in (cascades through the party) records no removals.
select set_config('request.jwt.claims', json_build_object('sub', :'p4', 'role', 'authenticated')::text, true);
select lives_ok(format('delete from auth.users where id = %L', :'p4'), 'deleting a party leader''s account works');
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from public.party_kicks), 0, 'deleting an account records no removals');

select * from finish();
rollback;
