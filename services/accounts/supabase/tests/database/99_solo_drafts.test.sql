begin;
\ir _helpers.psql
select plan(32);

select tests.create_user('solo@example.com') as solo \gset
select tests.create_user('other@example.com') as other \gset

select tests.sign_in_as('solo@example.com');
select public.start_solo_draft() as draft \gset
select is(public.start_solo_draft(), :'draft'::uuid, 'a second tab gets the same open draft');

-- Entries.
select lives_ok(format($$select public.add_solo_draft_action(%L, 'ally', 74::smallint, 2::smallint, 'pc')$$, :'draft'),
  'an ally with a position is added');
select public.add_solo_draft_action(:'draft', 'enemy', 11::smallint, null, 'pc');
select public.add_solo_draft_action(:'draft', 'ban', 1::smallint, null, 'phone');
select results_eq(format('select hero_id::int, kind, position::int from public.solo_draft_state(%L) order by hero_id', :'draft'),
  $$values (1, 'ban'::text, null::int), (11, 'enemy', null), (74, 'ally', 2)$$, 'the board replays the entries');

-- Watch Dota sending the same read twice, and a remove of a hero that is not in, change nothing.
select public.add_solo_draft_action(:'draft', 'enemy', 11::smallint, null, 'pc');
select public.add_solo_draft_action(:'draft', 'remove', 99::smallint, null, 'pc');
select is((select count(*)::int from public.solo_draft_actions where draft_id = :'draft'), 3, 'repeats are skipped');

select throws_ok(format($$select public.add_solo_draft_action(%L, 'ally', 11::smallint, null, 'pc')$$, :'draft'),
  '23505', 'That hero is already in the draft', 'a hero is in the draft once');
select throws_ok(format($$select public.add_solo_draft_action(%L, 'ban', 5::smallint, 3::smallint, 'pc')$$, :'draft'),
  '22023', 'Only picks have a position', 'bans have no position');
select throws_ok(format($$select public.add_solo_draft_action(%L, 'ally', 5::smallint, 6::smallint, 'pc')$$, :'draft'),
  '22023', 'Unknown hero or position', 'a position is 1 to 5');
select throws_ok(format($$select public.add_solo_draft_action(%L, 'ally', 5::smallint, null, '')$$, :'draft'),
  '22023', 'Missing device', 'every entry names its device');
select public.add_solo_draft_action(:'draft', 'ally', h::smallint, null, 'pc') from generate_series(20, 23) h;
select throws_ok(format($$select public.add_solo_draft_action(%L, 'ally', 30::smallint, null, 'pc')$$, :'draft'),
  '54000', 'That team already has 5 picks', 'a team has 5 picks');

-- Entering a pick again moves it; removing takes it out.
select public.add_solo_draft_action(:'draft', 'ally', 74::smallint, 3::smallint, 'phone');
select public.add_solo_draft_action(:'draft', 'remove', 1::smallint, null, 'phone');
select results_eq(format('select hero_id::int, position::int from public.solo_draft_state(%L) where hero_id in (1, 74)', :'draft'),
  $$values (74, 3)$$, 'a pick moves and a ban comes out');

-- Side, beat and seen.
select public.set_solo_draft_side(:'draft', 'dire');
select public.solo_draft_beat(:'draft', true);
select public.solo_draft_seen(:'draft');
select ok((select side = 'dire' and watch_age < 5 and phone_age < 5 from public.solo_draft_status(:'draft')),
  'the status has the side and fresh ages');
select public.solo_draft_beat(:'draft', false);
select ok((select watch_age is null from public.solo_draft_status(:'draft')), 'a stopped PC has no watch age');
select throws_ok(format($$select public.set_solo_draft_side(%L, 'left')$$, :'draft'), '22023', 'Unknown side',
  'a side is Radiant or Dire');

-- Direct writes are refused; everything goes through the functions.
select throws_ok(format($$insert into public.solo_draft_actions (draft_id, kind, hero_id, device) values (%L, 'ban', 2, 'x')$$, :'draft'),
  '42501', null, 'actions cannot be inserted directly');
select throws_ok(format($$update public.solo_drafts set side = 'radiant' where id = %L$$, :'draft'),
  '42501', null, 'drafts cannot be updated directly');

-- Another player sees nothing and can change nothing.
select tests.sign_out();
select tests.sign_in_as('other@example.com');
select is((select count(*)::int from public.solo_drafts), 0, 'other players do not see the draft');
select is((select count(*)::int from public.solo_draft_actions), 0, 'or its entries');
select is((select count(*)::int from public.solo_draft_state(:'draft')), 0, 'or its board');
select is((select count(*)::int from public.solo_draft_status(:'draft')), 0, 'or its status');
select throws_ok(format($$select public.add_solo_draft_action(%L, 'ban', 2::smallint, null, 'x')$$, :'draft'),
  'P0002', 'This draft has ended', 'and cannot add to it');
select throws_ok(format($$select public.solo_draft_beat(%L, true)$$, :'draft'),
  'P0002', 'This draft has ended', 'or beat for it');

-- Start Over.
select tests.sign_out();
select tests.sign_in_as('solo@example.com');
select public.new_solo_draft() as fresh \gset
select isnt(:'fresh'::uuid, :'draft'::uuid, 'Start Over makes a new draft');
select throws_ok(format($$select public.add_solo_draft_action(%L, 'ban', 2::smallint, null, 'pc')$$, :'draft'),
  'P0002', 'This draft has ended', 'the old draft takes no more entries');

-- A draft untouched for 2 hours is not handed out again.
reset role;
update public.solo_drafts set created_at = now() - interval '3 hours' where id = :'fresh';
select tests.sign_in_as('solo@example.com');
select isnt(public.start_solo_draft(), :'fresh'::uuid, 'an old untouched draft is ended');

-- Phone sign-in codes.
select public.create_phone_sign_in() as code1 \gset
select public.create_phone_sign_in() as code2 \gset
select ok(length(:'code2') = 32 and :'code2' ~ '^[A-Za-z0-9_-]+$', 'a code is 32 url-safe characters');
select throws_ok(format($$select public.redeem_phone_sign_in(%L)$$, :'code2'), '42501', null,
  'players cannot redeem codes themselves');
select throws_ok('select * from public.phone_sign_ins', '42501', null, 'or read the codes');
reset role;
select is(public.redeem_phone_sign_in(:'code1'), null, 'a newer code makes the older one stop working');
select is(public.redeem_phone_sign_in(:'code2'), :'solo'::uuid, 'a code signs in its player');
select is(public.redeem_phone_sign_in(:'code2'), null, 'a code works once');

select tests.sign_in_as('solo@example.com');
select public.create_phone_sign_in() as code3 \gset
reset role;
update public.phone_sign_ins set expires_at = now() - interval '1 second';
select is(public.redeem_phone_sign_in(:'code3'), null, 'an expired code does not work');

select tests.sign_in_anon();
select throws_ok('select public.create_phone_sign_in()', '42501', null, 'signed out players get no code');

select * from finish();
rollback;
