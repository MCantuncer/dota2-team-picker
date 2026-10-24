begin;
\ir _helpers.psql
select plan(14);

select tests.create_user('ana@example.com') as ana \gset
select tests.create_user('ben@example.com') as ben \gset

-- Sign-up creates a profile with a name taken from the email.
select is((select display_name from public.profiles where id = :'ana'), 'ana', 'sign-up creates a profile');
select is((select user_type from public.profiles where id = :'ben'), 'user', 'new accounts are plain users');

-- Visitors who are not signed in see nothing.
select tests.sign_in_anon();
select is_empty('select * from public.profiles', 'anon sees no profiles');
select is_empty('select * from public.favorite_heroes', 'anon sees no favorite heroes');
select tests.sign_out();

select tests.sign_in_as('ana@example.com');
select results_eq('select id from public.profiles', array[:'ana'::uuid], 'a user sees only their own profile');

-- Name and picture are editable.
update public.profiles set display_name = 'Ana' where id = :'ana';
select is((select display_name from public.profiles where id = :'ana'), 'Ana', 'a user can rename themselves');

-- Everything else is written by the server only.
select throws_ok(format('update public.profiles set user_type = %L where id = %L', 'admin', :'ana'),
  '42501', null, 'a user cannot make themselves admin');
select throws_ok(format('update public.profiles set rank_tier = 80 where id = %L', :'ana'),
  '42501', null, 'a user cannot change their rank');
select throws_ok(format('update public.profiles set steam_id = %L where id = %L', '76561198000000000', :'ana'),
  '42501', null, 'a user cannot set a Steam id');
select throws_ok(format('delete from public.profiles where id = %L', :'ana'),
  '42501', null, 'a user cannot delete their profile row');

-- Someone else's profile can't be changed.
update public.profiles set display_name = 'hacked' where id = :'ben';

-- Favorite heroes: own rows only.
insert into public.favorite_heroes (user_id, position, hero_id) values (:'ana', 2, 1);
select throws_ok(format('insert into public.favorite_heroes (user_id, position, hero_id) values (%L, 2, 1)', :'ben'),
  '42501', null, 'a user cannot add favorites for someone else');
insert into public.favorite_positions (user_id, position) values (:'ana', 2);
select throws_ok(format('insert into public.favorite_positions (user_id, position) values (%L, 2)', :'ben'),
  '42501', null, 'a user cannot add positions for someone else');

select tests.sign_out();
select is((select display_name from public.profiles where id = :'ben'), 'ben', 'a user cannot rename someone else');

select tests.sign_in_as('ben@example.com');
select is_empty('select * from public.favorite_heroes', 'a user cannot read someone else''s favorites');

select * from finish();
rollback;
