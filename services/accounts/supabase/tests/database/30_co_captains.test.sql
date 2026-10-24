begin;
\ir _helpers.psql
select plan(15);

select tests.create_user('own@example.com', 'captain') as own \gset
select tests.create_user('co@example.com') as co \gset
select tests.create_user('co2@example.com') as co2 \gset
select tests.create_user('pl@example.com') as pl \gset
select tests.create_user('out@example.com') as out \gset

insert into public.teams (owner_id, name) values (:'own', 'Dire') returning id as team \gset
insert into public.team_members (team_id, user_id, role) values
  (:'team', :'co', 'co_captain'), (:'team', :'co2', 'co_captain'), (:'team', :'pl', 'player');
insert into public.team_invites (team_id, email) values (:'team', 'new@example.com');
insert into public.team_lineups (team_id) values (:'team');
insert into public.favorite_heroes (user_id, position, hero_id) values (:'pl', 3, 2);

-- Only the owner changes roles.
select tests.sign_in_as('own@example.com');
update public.team_members set role = 'co_captain' where user_id = :'pl';
select tests.sign_out();
select is((select role from public.team_members where user_id = :'pl'), 'co_captain', 'the owner can make a member co-captain');
update public.team_members set role = 'player' where user_id = :'pl';

select tests.sign_in_as('co@example.com');
update public.team_members set role = 'co_captain' where user_id = :'pl';
select throws_ok(format('update public.team_members set team_id = gen_random_uuid() where user_id = %L', :'co'),
  '42501', null, 'members cannot move themselves to another team');
select tests.sign_out();
select is((select role from public.team_members where user_id = :'pl'), 'player', 'a co-captain cannot change roles');

select tests.sign_in_as('pl@example.com');
update public.team_members set role = 'co_captain' where user_id = :'pl';
select tests.sign_out();
select is((select role from public.team_members where user_id = :'pl'), 'player', 'a player cannot promote themselves');

-- A co-captain runs the team: members, invites, lineup and members' favorites.
select tests.sign_in_as('co@example.com');
select is((select count(*)::int from public.team_members where team_id = :'team'), 3, 'a co-captain sees every member');
select is((select count(*)::int from public.team_invites), 1, 'a co-captain sees the invites');
select is((select count(*)::int from public.team_lineups), 1, 'a co-captain sees the lineup');
update public.team_lineups set rank_bracket = 5 where team_id = :'team';
select results_eq('select hero_id from public.favorite_heroes', array[2::smallint], 'a co-captain sees members'' favorites');
update public.teams set name = 'Taken' where id = :'team';

-- ...but cannot remove the other co-captain, only players.
delete from public.team_members where user_id = :'co2';
delete from public.team_members where user_id = :'pl';
select tests.sign_out();
select is((select rank_bracket from public.team_lineups where team_id = :'team'), 5::smallint, 'a co-captain can set the lineup');
select is((select name from public.teams where id = :'team'), 'Dire', 'a co-captain cannot rename the team');
select isnt_empty(format('select 1 from public.team_members where user_id = %L', :'co2'), 'a co-captain cannot remove another co-captain');
select is_empty(format('select 1 from public.team_members where user_id = %L', :'pl'), 'a co-captain can remove a player');

-- Players still see only their own membership.
insert into public.team_members (team_id, user_id) values (:'team', :'pl');
select tests.sign_in_as('pl@example.com');
select results_eq('select user_id from public.team_members', array[:'pl'::uuid], 'a player sees only their own membership');
select is_empty('select * from public.team_invites', 'a player cannot see invites');

-- Outsiders see nothing.
select tests.sign_out();
select tests.sign_in_as('out@example.com');
select is_empty('select * from public.team_members', 'an outsider sees no members');

select * from finish();
rollback;
