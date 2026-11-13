begin;
\ir _helpers.psql
select plan(28);

select tests.create_user('lead@example.com') as lead \gset
select tests.create_user('pal@example.com') as pal \gset
select tests.create_user('quiet@example.com') as quiet \gset
select tests.create_user('mate@example.com') as mate \gset
select tests.create_user('guest@example.com') as guest \gset
select tests.create_user('other@example.com') as other \gset
select tests.create_user('outsider@example.com') as outsider \gset

-- pal and quiet are the leader's friends; quiet doesn't share heroes with friends. mate is in the
-- leader's Stack. guest is nobody's friend (joins by link). other leads a second party.
insert into public.friendships (requester_id, addressee_id, status) values
  (:'lead', :'pal', 'accepted'), (:'lead', :'quiet', 'accepted'), (:'other', :'pal', 'accepted');
update public.profiles set share_heroes_with_friends = false where id = :'quiet';
insert into public.teams (owner_id, name) values (:'lead', 'Night Shift') returning id as team \gset
insert into public.team_members (team_id, user_id) values (:'team', :'mate');
insert into public.favorite_heroes (user_id, position, hero_id) values (:'mate', 5, 26), (:'quiet', 4, 128);

-- Starting a party seats the leader.
select tests.sign_in_as('lead@example.com');
select public.start_party(null, 2::smallint) as party \gset
select is((select position from public.party_view()), 2::smallint, 'the leader starts in the seat they pick');
select throws_ok('select public.start_party(null, 7::smallint)', '22023', null, 'a seat is 1 to 5');

-- Inviting seats the player.
select public.invite_to_party(:'mate', 5::smallint);
select results_eq('select user_id, position::int, invite_live from public.party_seats_view()',
  format($$values (%L::uuid, 5, true)$$, :'mate'), 'an invite seats the player, with a live pop-up');
select throws_ok(format('select public.invite_to_party(%L, 2::smallint)', :'pal'), '23505', null,
  'a seat a member holds cannot be given');
select throws_ok(format('select public.invite_to_party(%L, 5::smallint)', :'pal'), '23505', null,
  'a seat another seated player holds cannot be given');
select public.invite_to_party(:'pal');
select is((select position from public.party_seats_view() where user_id = :'pal'), 1::smallint,
  'without a seat the player takes the first free one');
select public.invite_to_party(:'quiet', 4::smallint);

-- The whole party reads a seated player's heroes when they share with whoever seated them.
select is((select seated from public.party_player_stats() where user_id = :'mate'), true,
  'a seated Stack mate is in the party stats');
select is((select favorites from public.party_player_stats() where user_id = :'mate'), '{"5": [26]}'::jsonb,
  'with their heroes');
select is_empty(format('select 1 from public.party_player_stats() where user_id = %L', :'quiet'),
  'a seated friend who does not share with friends stays out');
select is((select count(*)::int from public.party_hero_pool() where user_id = :'mate'), 1,
  'the planner''s hero pool has the seated Stack mate');

-- The pop-up runs out; the seat stays, and joining late still works.
select tests.sign_out();
update public.party_invites set expires_at = now() - interval '1 minute' where user_id = :'mate';
select tests.sign_in_as('mate@example.com');
select results_eq('select position::int, seated from public.my_party_invites()', $$values (5, true)$$,
  'an old invite still shows while its seat is waiting');
select public.answer_party_invite(:'party', true);
select is((select position from public.party_members where user_id = :'mate'), 5::smallint,
  'joining late takes the waiting seat');
select is_empty(format('select 1 from public.party_seats where user_id = %L', :'mate'), 'the seat is now a membership');

-- Positions: one per seat, swaps between members, no taking a waiting seat.
select throws_ok('select public.set_party_position(1::smallint)', '23505', null, 'a seat waiting for a player cannot be taken');
select throws_ok('select public.set_party_position(null)', '22023', null, 'a member always has a position');
select public.set_party_position(2::smallint);
select tests.sign_out();
select results_eq(
  format('select user_id, position::int, position_set_by from public.party_members where party_id = %L order by position', :'party'),
  format($$values (%L::uuid, 2, %L::uuid), (%L::uuid, 5, %L::uuid)$$, :'mate', :'mate', :'lead', :'mate'),
  'taking a member''s position swaps the two, and says who did it');

-- The planner moves anyone; others cannot.
select tests.sign_in_as('mate@example.com');
select throws_ok(format('select public.set_member_position(%L, 3::smallint)', :'pal'), '42501', null,
  'only the planner moves other players');
select tests.sign_out();
select tests.sign_in_as('lead@example.com');
select public.set_member_position(:'pal', 2::smallint);
select tests.sign_out();
select is((select position from public.party_seats where user_id = :'pal'), 2::smallint, 'the planner moves a seated player');
select is((select position from public.party_members where user_id = :'mate'), 1::smallint,
  'into a member''s seat, swapping them');

-- One waiting seat per player across open parties.
select tests.sign_in_as('other@example.com');
select public.start_party();
select throws_ok(format('select public.invite_to_party(%L)', :'pal'), '23505', null,
  'a player waiting in one party cannot be seated in another');
select tests.sign_out();

-- Declining frees the seat; the leader's x frees it and closes the pop-up.
select tests.sign_in_as('quiet@example.com');
select public.answer_party_invite(:'party', false);
select tests.sign_out();
select is_empty(format('select 1 from public.party_seats where user_id = %L', :'quiet'), 'declining frees the seat');
select tests.sign_in_as('lead@example.com');
select public.unseat_player(:'pal');
select tests.sign_out();
select is((select status from public.party_invites where user_id = :'pal' and party_id = :'party'), 'cancelled',
  'the leader''s x cancels the invite');
select tests.sign_in_as('pal@example.com');
select throws_ok(format('select public.answer_party_invite(%L, true)', :'party'), 'P0002', null,
  'a cancelled invite cannot be accepted');
select tests.sign_out();

-- A link joiner takes the first seat nobody holds, skipping seats that wait for someone.
select tests.sign_in_as('lead@example.com');
select public.invite_to_party(:'quiet', 2::smallint);
select (public.party_link()).code as code \gset
select tests.sign_out();
select tests.sign_in_as('guest@example.com');
select public.join_party_by_link(:'code');
select tests.sign_out();
select is((select position from public.party_members where user_id = :'guest'), 3::smallint,
  'a link joiner skips the seat waiting for quiet');

-- Only the party reads its seats.
select tests.sign_in_as('outsider@example.com');
select is_empty('select * from public.party_seats', 'outsiders cannot read seats');
select is_empty('select * from public.party_seats_view()', 'or the seats view');
select tests.sign_out();
select tests.sign_in_as('quiet@example.com');
select is((select count(*)::int from public.party_seats), 1, 'a seated player reads their own seat');
select tests.sign_out();

-- Starting another party frees the starter's waiting seat.
select tests.sign_in_as('quiet@example.com');
select public.start_party();
select tests.sign_out();
select is_empty(format('select 1 from public.party_seats where user_id = %L', :'quiet'), 'leading a party frees a waiting seat');

select * from finish();
rollback;
