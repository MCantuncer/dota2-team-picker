begin;
\ir _helpers.psql
select plan(14);

select tests.create_user('lead@example.com') as lead \gset
select tests.create_user('pal@example.com') as pal \gset
select tests.create_user('cap@example.com') as cap \gset
select tests.create_user('out@example.com') as out \gset
update public.profiles set rank_tier = 54, hero_stats = '{"8": {"games": 10, "wins": 6}}' where id = :'pal';
insert into public.favorite_positions (user_id, position) values (:'pal', 3), (:'pal', 1);
insert into public.favorite_heroes (user_id, position, hero_id, created_at) values
  (:'pal', 1, 8, now() - interval '2 days'), (:'pal', 1, 1, now() - interval '1 day'), (:'pal', 3, 2, now());

insert into public.parties (leader_id) values (:'lead') returning id as party \gset
insert into public.party_members (party_id, user_id) values (:'party', :'lead'), (:'party', :'pal'), (:'party', :'cap');

-- Every member sees every member's heroes and stats.
select tests.sign_in_as('cap@example.com');
select is((select count(*)::int from public.party_player_stats()), 3, 'a member sees every member of the party');
select is((select user_id from public.party_player_stats() limit 1), :'lead'::uuid, 'the leader comes first');
select is((select positions from public.party_player_stats() where user_id = :'pal'), array[1, 3]::smallint[],
  'positions come sorted');
select is((select favorites from public.party_player_stats() where user_id = :'pal'), '{"1": [8, 1], "3": [2]}'::jsonb,
  'favorites per position, in the order they were added');
select is((select hero_stats -> '8' ->> 'games' from public.party_player_stats() where user_id = :'pal'), '10',
  'match stats come along');
select is((select rank_tier from public.party_player_stats() where user_id = :'pal'), 54::smallint, 'rank comes along');
select is((select favorites from public.party_player_stats() where user_id = :'lead'), '{}'::jsonb,
  'a member with no favorites gets an empty object');

-- Without a Draft Captain the leader plans, so only the leader sets the party rank.
select throws_ok('select public.set_party_rank(5::smallint)', '42501', null, 'a member who does not plan cannot set the rank');
select tests.sign_out();

select tests.sign_in_as('lead@example.com');
select lives_ok('select public.set_party_rank(5::smallint)', 'the leader sets the rank while there is no captain');
select is((select rank_bracket from public.parties where id = :'party'), 5::smallint, 'every member reads the party rank');
select throws_ok('select public.set_party_rank(9::smallint)', '22023', null, 'the rank stays between Herald and Immortal');
select tests.sign_out();

update public.parties set captain_id = :'cap' where id = :'party';
select tests.sign_in_as('lead@example.com');
select throws_ok('select public.set_party_rank(6::smallint)', '42501', null, 'with a captain, the leader no longer sets it');
select tests.sign_out();
select tests.sign_in_as('cap@example.com');
select lives_ok('select public.set_party_rank(null)', 'the captain sets it, null goes back to their own rank');
select tests.sign_out();

select tests.sign_in_as('out@example.com');
select is_empty('select 1 from public.party_player_stats()', 'nobody outside the party sees any of it');
select tests.sign_out();

select * from finish();
rollback;
