begin;
\ir _helpers.psql
select plan(8);

select tests.create_user('own@example.com', 'captain') as own \gset
select tests.create_user('co@example.com') as co \gset
select tests.create_user('pl@example.com') as pl \gset
select tests.create_user('out@example.com') as out \gset

insert into public.teams (owner_id, name) values (:'own', 'Radiant') returning id as team \gset
insert into public.team_members (team_id, user_id, role) values (:'team', :'co', 'co_captain'), (:'team', :'pl', 'player');

-- The owner and a co-captain send plans in their own name.
select tests.sign_in_as('own@example.com');
select lives_ok(
  format($$insert into public.team_game_plans (team_id, sent_by, picks, enemies, bans, rank_bracket)
    values (%L, %L, '{42,13,49,30,100}', '{26,72,137,31,54}', '{1,67}', 5)$$, :'team', :'own'),
  'the owner sends a game plan');
select throws_ok(
  format($$insert into public.team_game_plans (team_id, sent_by, picks, enemies) values (%L, %L, '{1,2,3,4}', '{5,6,7,8,9}')$$, :'team', :'own'),
  '23514', null, 'a plan needs five heroes on each side');
select tests.sign_out();

select tests.sign_in_as('co@example.com');
select lives_ok(
  format($$insert into public.team_game_plans (team_id, sent_by, picks, enemies) values (%L, %L, '{1,2,3,4,5}', '{6,7,8,9,10}')$$, :'team', :'co'),
  'a co-captain sends a game plan');
select throws_ok(
  format($$insert into public.team_game_plans (team_id, sent_by, picks, enemies) values (%L, %L, '{1,2,3,4,5}', '{6,7,8,9,10}')$$, :'team', :'own'),
  '42501', null, 'nobody sends a plan in someone else''s name');
select tests.sign_out();

-- Players read their team's plans but can't send one.
select tests.sign_in_as('pl@example.com');
select is((select count(*)::int from public.team_game_plans), 2, 'a player reads the team''s plans');
select throws_ok(
  format($$insert into public.team_game_plans (team_id, sent_by, picks, enemies) values (%L, %L, '{1,2,3,4,5}', '{6,7,8,9,10}')$$, :'team', :'pl'),
  '42501', null, 'a player cannot send a plan');
update public.team_game_plans set picks = '{1,1,1,1,1}';
select tests.sign_out();
select is((select count(*)::int from public.team_game_plans where picks = '{1,1,1,1,1}'), 0, 'plans are never changed');

select tests.sign_in_as('out@example.com');
select is_empty('select * from public.team_game_plans', 'people outside the team see no plans');
select tests.sign_out();

select * from finish();
rollback;
