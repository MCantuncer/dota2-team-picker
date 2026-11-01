begin;
\ir _helpers.psql
select plan(4);

select tests.create_user('lead@example.com') as lead \gset
select tests.create_user('pal@example.com') as pal \gset
select tests.create_user('stranger@example.com') as stranger \gset

insert into public.friendships (requester_id, addressee_id, status) values (:'lead', :'pal', 'accepted');
insert into public.favorite_heroes (user_id, position, hero_id) values
  (:'lead', 1, 1), (:'pal', 5, 5), (:'pal', 0, 6), (:'stranger', 2, 2);

-- A party of two.
select tests.sign_in_as('lead@example.com');
select public.start_party() as party \gset
select public.invite_to_party(:'pal');
select tests.sign_out();
select tests.sign_in_as('pal@example.com');
select public.answer_party_invite(:'party', true);

select is_empty('select * from public.party_hero_pool()', 'a member who is not the leader sees no pool');

select tests.sign_out();
select tests.sign_in_as('lead@example.com');
select results_eq(
  format('select user_id::text, position::int, hero_id::int from public.party_hero_pool() order by user_id = %L::uuid desc, position, hero_id', :'lead'),
  format($$values (%L, 1, 1), (%L, 0, 6), (%L, 5, 5)$$, :'lead', :'pal', :'pal'),
  'the leader sees every member''s favorites and no one else''s');

-- A player who leaves takes their heroes with them.
select tests.sign_out();
select tests.sign_in_as('pal@example.com');
select public.leave_party();
select tests.sign_out();
select tests.sign_in_as('lead@example.com');
select results_eq('select hero_id::int from public.party_hero_pool()', $$values (1)$$, 'a player who left is not in the pool');

select tests.sign_out();
select tests.sign_in_as('stranger@example.com');
select is_empty('select * from public.party_hero_pool()', 'outside a party the pool is empty');

select * from finish();
rollback;
