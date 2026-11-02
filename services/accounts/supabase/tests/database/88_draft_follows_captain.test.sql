begin;
\ir _helpers.psql
select plan(11);

select tests.create_user('lead@example.com') as lead \gset
select tests.create_user('ali@example.com') as ali \gset

insert into public.friendships (requester_id, addressee_id, status) values (:'lead', :'ali', 'accepted');
insert into public.favorite_heroes (user_id, position, hero_id) values (:'lead', 2, 11), (:'ali', 1, 1);

select tests.sign_in_as('lead@example.com');
select public.start_party() as party \gset
select public.invite_to_party(:'ali');
select tests.sign_out();
select tests.sign_in_as('ali@example.com');
select public.answer_party_invite(:'party', true);
select public.start_party_draft() as draft \gset

-- No captain: anyone enters the draft, and the leader plans.
select lives_ok(format('select public.add_draft_action(%L, %L, 2::smallint)', :'draft', 'enemy'), 'without a captain anyone enters picks');
select is_empty('select * from public.party_hero_pool()', 'without a captain only the leader reads the pool');

-- Ali becomes captain: the draft and the pool are Ali's.
select public.become_captain();
select lives_ok(format('select public.add_draft_action(%L, %L, 3::smallint)', :'draft', 'ban'), 'the captain enters picks');
select is((select count(*)::int from public.party_hero_pool()), 2, 'the captain reads the whole party''s pool');
select tests.sign_out();

select tests.sign_in_as('lead@example.com');
select throws_ok(format('select public.add_draft_action(%L, %L, 4::smallint)', :'draft', 'enemy'), '42501', null,
  'someone else cannot enter picks while there is a captain');
select throws_ok(format('select public.end_party_draft(%L)', :'draft'), '42501', null,
  'someone else cannot end the draft while there is a captain');
select is_empty('select * from public.party_hero_pool()', 'the leader no longer reads the pool while someone else is captain');
select is(public.start_party_draft(), :'draft'::uuid, 'everyone can still open the party''s draft');
select tests.sign_out();

select tests.sign_in_as('ali@example.com');
select lives_ok(format('select public.end_party_draft(%L)', :'draft'), 'the captain ends the draft');
select tests.sign_out();
select tests.sign_in_as('lead@example.com');
select isnt(public.start_party_draft(), :'draft'::uuid, 'any member starts the next draft');

-- Stepping down hands the draft back to everyone.
select tests.sign_out();
select tests.sign_in_as('ali@example.com');
select public.step_down_captain();
select tests.sign_out();
select tests.sign_in_as('lead@example.com');
select lives_ok(format('select public.add_draft_action(public.start_party_draft(), %L, 5::smallint)', 'ban'),
  'after the captain steps down anyone enters picks again');
select tests.sign_out();

select * from finish();
rollback;
