begin;
\ir _helpers.psql
select plan(6);

select tests.create_user('mid@example.com') as mid \gset
select tests.create_user('blank@example.com') as blank \gset
select tests.create_user('sup@example.com') as sup \gset
select tests.create_user('flex@example.com') as flex \gset
select tests.create_user('taken@example.com') as taken \gset
select tests.create_user('guest@example.com') as guest \gset

insert into public.favorite_positions (user_id, position) values
  (:'mid', 2), (:'mid', 3), (:'sup', 4), (:'flex', 2), (:'flex', 3), (:'taken', 2), (:'guest', 5);
insert into public.friendships (requester_id, addressee_id, status) values
  (:'mid', :'sup', 'accepted'), (:'mid', :'flex', 'accepted'), (:'mid', :'taken', 'accepted');

-- The leader starts in their first position, or Carry when My Heroes has none.
select tests.sign_in_as('blank@example.com');
select public.start_party();
select is((select position from public.party_view()), 1::smallint, 'with no positions the leader starts in Carry');
select tests.sign_out();
select tests.sign_in_as('mid@example.com');
select public.start_party() as party \gset
select is((select position from public.party_view()), 2::smallint, 'the leader starts in their first position');

-- Invites without a seat take the first free position the player plays, else the first free one.
select public.invite_to_party(:'sup');
select public.invite_to_party(:'flex');
select public.invite_to_party(:'taken');
select results_eq('select user_id, position::int from public.party_seats_view() order by position',
  format($$values (%L::uuid, 1), (%L::uuid, 3), (%L::uuid, 4)$$, :'taken', :'flex', :'sup'),
  'each seated player gets a free position they play, else the first free one');
select (public.party_link()).code as code \gset
select tests.sign_out();

-- Joining without a seat does the same.
select tests.sign_in_as('guest@example.com');
select public.join_party_by_link(:'code');
select tests.sign_out();
select is((select position from public.party_members where user_id = :'guest'), 5::smallint,
  'a link joiner takes a free position they play');

-- Accepting keeps the seat the player was given.
select tests.sign_in_as('sup@example.com');
select public.answer_party_invite(:'party', true);
select tests.sign_out();
select is((select position from public.party_members where user_id = :'sup'), 4::smallint, 'accepting takes the seat');

-- An explicit seat still wins over the player's positions.
select tests.sign_in_as('mid@example.com');
select public.unseat_player(:'flex');
select public.invite_to_party(:'flex', 3::smallint);
select tests.sign_out();
select is((select position from public.party_seats where user_id = :'flex'), 3::smallint, 'a chosen seat is kept');

select * from finish();
rollback;
