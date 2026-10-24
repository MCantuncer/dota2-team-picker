begin;
\ir _helpers.psql
select plan(16);

select tests.create_user('lead@example.com') as lead \gset
select tests.create_user('pal@example.com') as pal \gset
select tests.create_user('mate@example.com') as mate \gset
select tests.create_user('stranger@example.com') as stranger \gset
select tests.create_user('p4@example.com') as p4 \gset
select tests.create_user('p5@example.com') as p5 \gset
select tests.create_user('p6@example.com') as p6 \gset

insert into public.friendships (requester_id, addressee_id, status) values
  (:'lead', :'pal', 'accepted'), (:'lead', :'p4', 'accepted'), (:'lead', :'p5', 'accepted'), (:'lead', :'p6', 'accepted'),
  (:'lead', :'stranger', 'pending');
insert into public.teams (owner_id, name) values (:'mate', 'Radiant') returning id as team \gset
insert into public.team_members (team_id, user_id) values (:'team', :'lead');

-- Starting a party and inviting.
select tests.sign_in_as('lead@example.com');
select public.start_party() as party \gset
select results_eq('select user_id from public.party_view()', array[:'lead'::uuid], 'the starter is in the party');
select lives_ok(format('select public.invite_to_party(%L)', :'pal'), 'a friend can be invited');
select lives_ok(format('select public.invite_to_party(%L)', :'mate'), 'a teammate can be invited');
select throws_ok(format('select public.invite_to_party(%L)', :'stranger'), '42501', null, 'a pending friend cannot be invited');
select throws_ok(format('insert into public.party_members (party_id, user_id) values (%L, %L)', :'party', :'stranger'),
  '42501', null, 'nobody joins by writing to the table');

-- The invite reaches only the invitee.
select tests.sign_out();
select tests.sign_in_as('stranger@example.com');
select is_empty('select * from public.party_invites', 'others cannot see the invites');
select is_empty('select * from public.party_view()', 'others are not in the party');
select tests.sign_out();
select tests.sign_in_as('pal@example.com');
select results_eq(format('select invited_by = %L and members = 1 from public.my_party_invites()', :'lead'),
  array[true], 'the invitee sees who invited them');
select throws_ok(format('select public.invite_to_party(%L)', :'lead'), 'P0002', null, 'only a party leader can invite');

-- Joining, and the five-player cap.
select public.answer_party_invite(:'party', true);
select is((select count(*)::int from public.party_view()), 2, 'accepting joins the party');
select is_empty('select * from public.my_party_invites()', 'an accepted invite no longer pops up');
select tests.sign_out();
select tests.sign_in_as('lead@example.com');
select public.invite_to_party(:'p4'), public.invite_to_party(:'p5'), public.invite_to_party(:'p6');
select tests.sign_out();
select tests.sign_in_as('mate@example.com');
select public.answer_party_invite(:'party', false);
select throws_ok(format('select public.answer_party_invite(%L, true)', :'party'), 'P0002', null, 'a declined invite is closed');
select tests.sign_out();
select tests.sign_in_as('p4@example.com');
select public.answer_party_invite(:'party', true);
select tests.sign_out();
select tests.sign_in_as('p5@example.com');
select public.answer_party_invite(:'party', true);
select tests.sign_out();
select tests.sign_in_as('p6@example.com');
select public.answer_party_invite(:'party', true);
select tests.sign_out();
select tests.sign_in_as('stranger@example.com');
select tests.sign_out();
insert into public.party_invites (party_id, user_id, invited_by) values (:'party', :'stranger', :'lead');
select tests.sign_in_as('stranger@example.com');
select throws_ok(format('select public.answer_party_invite(%L, true)', :'party'), '54000', null, 'a sixth player cannot join');

-- Positions, and the leader leaving.
select tests.sign_out();
select tests.sign_in_as('pal@example.com');
select public.set_party_position(3::smallint);
select tests.sign_out();
select tests.sign_in_as('lead@example.com');
select public.leave_party();
select tests.sign_out();
select is((select position from public.party_members where user_id = :'pal'), 3::smallint, 'members set their own position');
select is((select leader_id from public.parties where id = :'party'), :'pal'::uuid, 'the next player to join leads when the leader leaves');

-- Starting a new party leaves the old one.
select tests.sign_in_as('p4@example.com');
select public.start_party();
select tests.sign_out();
select is((select count(*)::int from public.party_members where party_id = :'party'), 3, 'starting a party leaves the old one');

select * from finish();
rollback;
