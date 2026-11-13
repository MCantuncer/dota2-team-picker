begin;
\ir _helpers.psql
select plan(17);

select tests.create_user('lead@example.com') as lead \gset
select tests.create_user('pal@example.com') as pal \gset
select tests.create_user('late@example.com') as late \gset
select tests.create_user('stranger@example.com') as stranger \gset

update public.profiles set steam_id = '76561197960265738' where id = :'pal';
insert into public.friendships (requester_id, addressee_id, status)
values (:'lead', :'pal', 'accepted'), (:'lead', :'late', 'accepted');

-- A party of two plays a draft; the pal saw suggestions for position 4.
select tests.sign_in_as('lead@example.com');
select public.start_party() as party \gset
select public.invite_to_party(:'pal');
select tests.sign_out();
select tests.sign_in_as('pal@example.com');
select public.answer_party_invite(:'party', true);
select public.start_party_draft() as draft \gset
select public.add_draft_action(:'draft', 'ally', 1::smallint, 4::smallint);
select public.save_draft_suggestions(:'draft', 4::smallint, '{1,2}', '{3,2}');

select is((select count(*)::int from public.draft_players), 0, 'an open draft has no saved players yet');
select public.end_party_draft(:'draft');

select tests.sign_out();
select results_eq(
  format('select user_id, account_id, position::int, hero_id::int from public.draft_players where draft_id = %L order by user_id = %L', :'draft', :'pal'),
  format($$values (%L::uuid, null::bigint, 1, null::int), (%L::uuid, 10::bigint, 4, null::int)$$, :'lead', :'pal'),
  'ending the draft saves both members, with the account and the position they were shown suggestions for, else their seat');

-- Someone joins after the game.
select tests.sign_out();
select tests.sign_in_as('lead@example.com');
select public.invite_to_party(:'late');
select tests.sign_out();
select tests.sign_in_as('late@example.com');
select public.answer_party_invite(:'party', true);
select is_empty(format('select * from public.party_drafts where id = %L', :'draft'), 'a later joiner cannot read the ended draft');
select is_empty(format('select * from public.draft_actions where draft_id = %L', :'draft'), 'nor its picks');
select is_empty(format('select * from public.draft_state(%L)', :'draft'), 'nor its state');
select is_empty(format('select * from public.draft_suggestions where draft_id = %L', :'draft'), 'nor the suggestions');
select is_empty('select * from public.draft_players', 'nor who played it');

-- The next draft is open to everyone in the party, the later joiner too.
select public.start_party_draft() as draft2 \gset
select isnt_empty(format('select * from public.party_drafts where id = %L', :'draft2'), 'an open draft is readable by the whole party');

-- The pal leaves the party and keeps the game.
select tests.sign_out();
select tests.sign_in_as('pal@example.com');
select public.leave_party();
select isnt_empty(format('select * from public.party_drafts where id = %L', :'draft'), 'a player who left still reads the draft');
select is((select count(*)::int from public.draft_actions where draft_id = :'draft'), 1, 'and its picks');
select is((select count(*)::int from public.draft_players where draft_id = :'draft'), 2, 'and who played it');
select is_empty(format('select * from public.party_drafts where id = %L', :'draft2'), 'but not the party''s open draft');

-- Outsiders and writes.
select tests.sign_out();
select tests.sign_in_as('stranger@example.com');
select is_empty('select * from public.draft_players', 'others cannot read who played');
select throws_ok(format('insert into public.draft_players (draft_id, user_id) values (%L, %L)', :'draft', :'stranger'),
  '42501', null, 'nobody writes to the table directly');
select throws_ok(format('select public.record_draft_players(%L)', :'draft'), '42501', null,
  'users cannot save players themselves');

-- The last member out ends the party's open draft and saves them as its player.
select tests.sign_out();
select tests.sign_in_as('lead@example.com');
select public.leave_party();
select tests.sign_out();
select tests.sign_in_as('late@example.com');
select public.leave_party();
select tests.sign_out();
select results_eq(
  format('select user_id, ended_at is not null from public.draft_players p join public.party_drafts d on d.id = p.draft_id where d.id = %L', :'draft2'),
  format($$values (%L::uuid, true)$$, :'late'),
  'the last one out ends the open draft and is saved as its player');

-- Deleting the account that started a draft keeps the draft for the others.
delete from auth.users where id = :'pal';
select is((select started_by from public.party_drafts where id = :'draft'), null, 'the draft stays, without its starter');

select * from finish();
rollback;
