begin;
\ir _helpers.psql
select plan(17);

select tests.create_user('lead@example.com') as lead \gset
select tests.create_user('pal@example.com') as pal \gset
select tests.create_user('stranger@example.com') as stranger \gset

insert into public.friendships (requester_id, addressee_id, status) values (:'lead', :'pal', 'accepted');

-- A party of two.
select tests.sign_in_as('lead@example.com');
select public.start_party() as party \gset
select public.invite_to_party(:'pal');
select tests.sign_out();
select tests.sign_in_as('pal@example.com');
select public.answer_party_invite(:'party', true);

-- Starting a draft: everyone in the party gets the same one.
select public.start_party_draft() as draft \gset
select tests.sign_out();
select tests.sign_in_as('lead@example.com');
select is(public.start_party_draft(), :'draft'::uuid, 'the party shares one open draft');

-- Entering picks and bans.
select lives_ok(format('select public.add_draft_action(%L, %L, 1::smallint, 1::smallint)', :'draft', 'ally'), 'a member adds an ally with a position');
select lives_ok(format('select public.add_draft_action(%L, %L, 2::smallint)', :'draft', 'enemy'), 'a member adds an enemy');
select lives_ok(format('select public.add_draft_action(%L, %L, 3::smallint)', :'draft', 'ban'), 'a member adds a ban');
select throws_ok(format('select public.add_draft_action(%L, %L, 2::smallint)', :'draft', 'ally'), '23505', null,
  'a hero is in the draft once');
select throws_ok(format('select public.add_draft_action(%L, %L, 4::smallint, 2::smallint)', :'draft', 'enemy'), '22023', null,
  'enemy picks have no position');
select lives_ok(format('select public.add_draft_action(%L, %L, 1::smallint, 3::smallint)', :'draft', 'ally'),
  'entering an ally again changes its position');
select tests.sign_out();
select tests.sign_in_as('pal@example.com');
select results_eq(format('select hero_id::int, kind, position::int from public.draft_state(%L) order by hero_id', :'draft'),
  $$values (1, 'ally', 3), (2, 'enemy', null::int), (3, 'ban', null::int)$$, 'the other member sees the same draft');

-- Taking a hero back out.
select lives_ok(format('select public.add_draft_action(%L, %L, 2::smallint)', :'draft', 'remove'), 'a member takes a hero back out');
select throws_ok(format('select public.add_draft_action(%L, %L, 2::smallint)', :'draft', 'remove'), 'P0002', null,
  'only a hero in the draft can be taken out');
select is((select count(*)::int from public.draft_state(:'draft') where kind = 'enemy'), 0, 'the removed hero is gone');

-- Five picks a team.
select public.add_draft_action(:'draft', 'enemy', h::smallint) from generate_series(10, 14) h;
select throws_ok(format('select public.add_draft_action(%L, %L, 15::smallint)', :'draft', 'enemy'), '54000', null,
  'a team has at most 5 picks');

-- Outsiders.
select tests.sign_out();
select tests.sign_in_as('stranger@example.com');
select is_empty('select * from public.draft_actions', 'others cannot read the actions');
select is_empty(format('select * from public.draft_state(%L)', :'draft'), 'others cannot read the draft');
select throws_ok(format('select public.add_draft_action(%L, %L, 20::smallint)', :'draft', 'ban'), 'P0002', null,
  'others cannot add to the draft');
select throws_ok(format('insert into public.draft_actions (draft_id, actor_id, kind, hero_id) values (%L, %L, %L, 20)',
  :'draft', :'stranger', 'ban'), '42501', null, 'nobody writes to the table directly');

-- Ending a draft gives the next game a fresh one.
select tests.sign_out();
select tests.sign_in_as('lead@example.com');
select public.end_party_draft(:'draft');
select isnt(public.start_party_draft(), :'draft'::uuid, 'after the draft ends, the next one is new');

select * from finish();
rollback;
