begin;
\ir _helpers.psql
select plan(18);

select tests.create_user('cap@example.com', 'captain') as cap \gset
select tests.create_user('mem@example.com') as mem \gset
select tests.create_user('out@example.com') as out \gset

-- Only captains create teams.
select tests.sign_in_as('out@example.com');
select throws_ok(format('insert into public.teams (owner_id, name) values (%L, %L)', :'out', 'Nope'),
  '42501', null, 'a plain user cannot create a team');
select tests.sign_out();

select tests.sign_in_as('cap@example.com');
insert into public.teams (owner_id, name) values (:'cap', 'Radiant') returning id as team \gset
select throws_ok(format('insert into public.teams (owner_id, name) values (%L, %L)', :'mem', 'Fake'),
  '42501', null, 'a captain cannot create a team owned by someone else');
select throws_ok(format('insert into public.team_members (team_id, user_id) values (%L, %L)', :'team', :'out'),
  '42501', null, 'members are added only by accepting an invite');
select tests.sign_out();

-- The captain's invite, as the team-invite function would create it.
insert into public.team_invites (team_id, email) values (:'team', 'mem@example.com') returning id as invite \gset
insert into public.team_invites (team_id, email) values (:'team', 'late@example.com') returning id as old_invite \gset
update public.team_invites set sent_at = now() - interval '8 days' where id = :'old_invite';

-- The join page works for visitors who are not signed in.
select tests.sign_in_anon();
select is((select team_name from public.get_team_invite(:'invite')), 'Radiant', 'anyone with the link sees the invite');
select is((select expired from public.get_team_invite(:'old_invite')), true, 'an 8 day old invite shows as expired');
select tests.sign_out();

-- Only the invited email can accept.
select tests.sign_in_as('out@example.com');
select throws_ok(format('select public.accept_team_invite(%L)', :'invite'),
  '42501', null, 'someone else cannot use the invite');
select is_empty('select * from public.teams', 'an outsider cannot see the team');
select is_empty('select * from public.team_invites', 'an outsider cannot see invites');
select throws_ok('select public.user_id_by_email(''cap@example.com'')',
  '42501', null, 'users cannot look up accounts by email');
select tests.sign_out();

select tests.sign_in_as('mem@example.com');
select is(public.accept_team_invite(:'invite'), :'team'::uuid, 'the invited user joins the team');
select results_eq('select name from public.teams', array['Radiant'], 'a member sees their team');
update public.teams set name = 'Mine now' where id = :'team';
select is_empty('select * from public.team_invites', 'a member cannot see the team''s invites');
select is_empty('select * from public.team_lineups', 'a member cannot see the lineup');
insert into public.favorite_heroes (user_id, position, hero_id) values (:'mem', 1, 8);
select tests.sign_out();
select is((select name from public.teams where id = :'team'), 'Radiant', 'a member cannot rename the team');

-- The captain reads members' profiles and favorites, nobody else's.
select tests.sign_in_as('cap@example.com');
select set_eq('select id from public.profiles', array[:'cap'::uuid, :'mem'::uuid],
  'a captain sees their own and their members'' profiles only');
select results_eq('select hero_id from public.favorite_heroes', array[8::smallint], 'a captain sees members'' favorites');
insert into public.team_lineups (team_id, slots) values (:'team', array[:'mem'::uuid, null, null, null, null]);
select tests.sign_out();

-- Expired invites can't be accepted.
select tests.create_user('late@example.com');
select tests.sign_in_as('late@example.com');
select throws_ok(format('select public.accept_team_invite(%L)', :'old_invite'),
  '42501', null, 'an expired invite cannot be accepted');
select tests.sign_out();

-- A member can leave.
select tests.sign_in_as('mem@example.com');
delete from public.team_members where user_id = :'mem';
select tests.sign_out();
select is_empty(format('select * from public.team_members where team_id = %L', :'team'), 'a member can leave the team');

select * from finish();
rollback;
