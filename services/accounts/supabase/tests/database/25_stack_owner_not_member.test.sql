begin;
\ir _helpers.psql
select plan(5);

select tests.create_user('own@example.com') as own \gset
select tests.create_user('pal@example.com') as pal \gset

insert into public.teams (owner_id, name) values (:'own', 'Space Marines') returning id as team \gset
insert into public.team_members (team_id, user_id) values (:'team', :'own');
select is_empty(format('select 1 from public.team_members where team_id = %L and user_id = %L', :'team', :'own'),
  'the owner never gets a member row');
insert into public.team_members (team_id, user_id) values (:'team', :'pal');
select is((select count(*)::int from public.team_members where team_id = :'team'), 1, 'other players still join');

-- The owner accepting an email invite to their own Stack changes nothing.
insert into public.team_invites (team_id, email, sent_at) values (:'team', 'own@example.com', now()) returning id as invite \gset
select tests.sign_in_as('own@example.com');
select is(public.accept_team_invite(:'invite'), :'team'::uuid, 'the owner can still open their own invite');
select is((select count(*)::int from public.stack_members(:'team')), 2, 'the owner is listed once');
select is((select members from public.stack_page(:'team')), 2, 'the player count counts the owner once');
select tests.sign_out();

select * from finish();
rollback;
