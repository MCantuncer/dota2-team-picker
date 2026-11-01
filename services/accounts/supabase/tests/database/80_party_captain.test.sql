begin;
\ir _helpers.psql
select plan(29);

select tests.create_user('lead@example.com') as lead \gset
select tests.create_user('ali@example.com') as ali \gset
select tests.create_user('bo@example.com') as bo \gset
select tests.create_user('cy@example.com') as cy \gset
select tests.create_user('out@example.com') as outsider \gset

insert into public.friendships (requester_id, addressee_id, status) values
  (:'lead', :'ali', 'accepted'), (:'lead', :'bo', 'accepted'), (:'lead', :'cy', 'accepted');

select tests.sign_in_as('lead@example.com');
select public.start_party() as party \gset
select public.invite_to_party(:'ali'), public.invite_to_party(:'bo'), public.invite_to_party(:'cy');
select tests.sign_out();
select tests.sign_in_as('ali@example.com');
select public.answer_party_invite(:'party', true);
select tests.sign_out();
select tests.sign_in_as('bo@example.com');
select public.answer_party_invite(:'party', true);
select tests.sign_out();
select tests.sign_in_as('cy@example.com');
select public.answer_party_invite(:'party', true);
select tests.sign_out();

-- Nobody is captain: the first one to ask gets it.
select tests.sign_in_as('ali@example.com');
select is((select count(*)::int from public.party_view() where captain_id is null), 4, 'a new party has no captain');
select is(public.become_captain(), 'captain', 'with no captain, Become captain takes it at once');
select is(public.become_captain(), 'captain', 'asking again as captain changes nothing');
select is((select bool_and(captain_online) from public.party_view()), true, 'a new captain counts as online');
select tests.sign_out();

-- Someone is captain and online: asking opens a request.
select tests.sign_in_as('bo@example.com');
select is(public.become_captain(), 'requested', 'with an online captain, Become captain asks');
select is(public.become_captain(), 'requested', 'asking again while your request is open still asks');
select results_eq('select distinct captain_request_by from public.party_view()', array[:'bo'::uuid], 'the party sees who asked');
select ok((select bool_and(captain_request_expires_at > server_now) from public.party_view()), 'the request runs out later, by the server clock');
select throws_ok('select public.answer_captain_request(true)', '42501', null, 'only the captain answers');
select tests.sign_out();

-- No keeps the captain; the same player waits before asking again.
select tests.sign_in_as('ali@example.com');
select public.answer_captain_request(false);
select is((select distinct captain_id from public.party_view()), :'ali'::uuid, 'No keeps the captain');
select is((select distinct captain_request_by from public.party_view()), null, 'No closes the request');
select throws_ok('select public.answer_captain_request(true)', 'P0002', null, 'a closed request cannot be answered');
select tests.sign_out();
select tests.sign_in_as('bo@example.com');
select throws_ok('select public.become_captain()', '54000', null, 'asking again at once after a No is refused');

-- After the cooldown, Yes hands it over.
select tests.sign_out();
update public.party_members set captain_asked_at = now() - interval '61 seconds' where user_id = :'bo';
select tests.sign_in_as('bo@example.com');
select is(public.become_captain(), 'requested', 'after the cooldown the player can ask again');
select tests.sign_out();
select tests.sign_in_as('cy@example.com');
select throws_ok('select public.become_captain()', '55000', null, 'a second player waits while a request is open');
select tests.sign_out();

-- A Yes inside the grace period still counts; after it, it is too late.
update public.parties set captain_request_at = now() - interval '33 seconds' where id = :'party';
select tests.sign_in_as('ali@example.com');
select lives_ok('select public.answer_captain_request(true)', 'a Yes a moment after the bar ends still lands');
select is((select distinct captain_id from public.party_view()), :'bo'::uuid, 'Yes hands the role over');
select tests.sign_out();
update public.parties set captain_request_by = :'ali', captain_request_at = now() - interval '36 seconds' where id = :'party';
select tests.sign_in_as('bo@example.com');
select throws_ok('select public.answer_captain_request(true)', 'P0002', null, 'a Yes after the grace period is too late');
select tests.sign_out();
update public.parties set captain_request_by = null, captain_request_at = null where id = :'party';

-- An offline captain loses the role to the next player who asks.
update public.party_captain_seen set seen_at = now() - interval '3 minutes' where party_id = :'party';
update public.party_members set captain_asked_at = null;
select tests.sign_in_as('ali@example.com');
select is(public.become_captain(), 'captain', 'a captain gone for 2 minutes is replaced at once');
select tests.sign_out();
select is((select seen_at > now() - interval '5 seconds' from public.party_captain_seen where party_id = :'party'), true,
  'the new captain starts with a fresh heartbeat');

-- The leader takes it without asking; the heartbeat is the captain's only.
select tests.sign_in_as('lead@example.com');
select is(public.become_captain(), 'captain', 'the party leader takes captain without asking');
select tests.sign_out();
update public.party_captain_seen set seen_at = now() - interval '1 minute' where party_id = :'party';
select tests.sign_in_as('ali@example.com');
select public.captain_heartbeat();
select tests.sign_out();
select is((select seen_at < now() - interval '30 seconds' from public.party_captain_seen where party_id = :'party'), true,
  'a heartbeat from someone else does nothing');

-- Nobody reads or writes the heartbeat table directly, and outsiders can't touch the role.
select tests.sign_in_as('lead@example.com');
select throws_ok('select * from public.party_captain_seen', '42501', null, 'the heartbeat table is not readable');
select tests.sign_out();
select tests.sign_in_as('out@example.com');
select throws_ok('select public.become_captain()', 'P0002', null, 'someone outside the party cannot become captain');
select tests.sign_out();

-- Leaving clears the role; stepping down too.
select tests.sign_in_as('bo@example.com');
select public.become_captain();
select tests.sign_out();
select tests.sign_in_as('lead@example.com');
select public.remove_from_party(:'bo');
select is((select distinct captain_request_by from public.party_view()), null, 'a removed player''s request goes with them');
select public.step_down_captain();
select is((select distinct captain_id from public.party_view()), null, 'stepping down leaves the party without a captain');
select tests.sign_out();
select tests.sign_in_as('cy@example.com');
select public.become_captain();
select public.leave_party();
select tests.sign_out();
select is((select captain_id from public.parties where id = :'party'), null, 'a captain who leaves stops being captain');

-- Deleting an account or the whole party runs the same clean-up without errors.
select tests.sign_in_as('ali@example.com');
select public.become_captain();
select tests.sign_out();
delete from auth.users where id = :'ali';
select is((select captain_id from public.parties where id = :'party'), null, 'a deleted account stops being captain');
select lives_ok(format('delete from public.parties where id = %L', :'party'), 'a party with members can still be deleted');

select * from finish();
rollback;
