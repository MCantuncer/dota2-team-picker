begin;
\ir _helpers.psql
select plan(17);

select tests.create_user('own@example.com') as own \gset
select tests.create_user('co@example.com') as co \gset
select tests.create_user('pl@example.com') as pl \gset
select tests.create_user('solo@example.com') as solo \gset

insert into public.friendships (requester_id, addressee_id, status) values (:'own', :'pl', 'accepted');

-- What the leaving player has: two Stacks with other players, one alone, a party with a draft, and a sent plan.
insert into public.teams (owner_id, name) values (:'own', 'Radiant') returning id as radiant \gset
insert into public.team_members (team_id, user_id, role) values (:'radiant', :'pl', 'player'), (:'radiant', :'co', 'co_captain');
insert into public.teams (owner_id, name) values (:'own', 'Dire') returning id as dire \gset
insert into public.team_members (team_id, user_id) values (:'dire', :'pl');
insert into public.teams (owner_id, name) values (:'own', 'Alone') returning id as alone \gset
insert into public.team_game_plans (team_id, sent_by, picks, enemies) values (:'radiant', :'own', '{1,2,3,4,5}', '{6,7,8,9,10}')
returning id as plan \gset

select tests.sign_in_as('own@example.com');
select public.start_party() as party \gset
select public.invite_to_party(:'pl');
select tests.sign_out();
select tests.sign_in_as('pl@example.com');
select public.answer_party_invite(:'party', true);
select tests.sign_out();
select tests.sign_in_as('own@example.com');
select public.start_party_draft() as draft \gset
select public.add_draft_action(:'draft', 'ally', 1::smallint, 1::smallint);
select tests.sign_out();

-- A party of one, open.
select tests.sign_in_as('solo@example.com');
select public.start_party() as solo_party \gset
select tests.sign_out();

-- Only a signed-in player can delete, and only their own account.
select tests.sign_in_anon();
select throws_ok('select public.delete_my_account()', '42501', null, 'a visitor cannot delete accounts');
select tests.sign_out();
select tests.sign_in_as('own@example.com');
select set_config('request.jwt.claims', '{"role": "authenticated"}', true);
select throws_ok('select public.delete_my_account()', '42501', null, 'a request without a player deletes nothing');
select tests.sign_out();

select tests.sign_in_as('own@example.com');
select lives_ok('select public.delete_my_account()', 'a player deletes their own account');
select tests.sign_out();

select is_empty(format('select 1 from auth.users where id = %L', :'own'), 'the sign in account is gone');
select is_empty(format('select 1 from public.profiles where id = %L', :'own'), 'the profile is gone');
select is_empty(format('select 1 from public.friendships where requester_id = %L or addressee_id = %L', :'own', :'own'),
  'their friendships are gone');

-- Stacks stay with the players still in them.
select is((select owner_id from public.teams where id = :'radiant'), :'co'::uuid, 'a co-captain takes over the Stack first');
select results_eq(format('select user_id from public.team_members where team_id = %L', :'radiant'), array[:'pl'::uuid],
  'the new owner is no longer listed as a member');
select is((select owner_id from public.teams where id = :'dire'), :'pl'::uuid, 'without a co-captain the next player takes over');
select is_empty(format('select 1 from public.teams where id = %L', :'alone'), 'a Stack with nobody else goes with its owner');

-- The party and shared history stay for everyone else.
select is((select leader_id from public.parties where id = :'party'), :'pl'::uuid, 'the next member leads the party');
select is((select closed_at is null from public.parties where id = :'party'), true, 'the party stays open');
select results_eq(format('select actor_id is null from public.draft_actions where draft_id = %L', :'draft'), array[true],
  'their draft picks stay in the draft without a name');
select is((select sent_by from public.team_game_plans where id = :'plan'), null::uuid, 'their sent game plan stays without a name');
select is((select count(*)::int from public.profiles where id in (:'co', :'pl', :'solo')), 3, 'other players are untouched');

-- A party of one closes, the way Leave Party closes it.
select tests.sign_in_as('solo@example.com');
select public.delete_my_account();
select tests.sign_out();
select is((select closed_at is not null and leader_id is null from public.parties where id = :'solo_party'), true,
  'a party with nobody left is closed');

-- Deleting every account at once (the clean start) goes through.
select lives_ok('delete from auth.users', 'every account can be deleted in one go');

select * from finish();
rollback;
