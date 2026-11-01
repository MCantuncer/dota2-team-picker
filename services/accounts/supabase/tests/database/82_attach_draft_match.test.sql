begin;
\ir _helpers.psql
select plan(11);

select tests.create_user('lead@example.com') as lead \gset
select tests.create_user('pal@example.com') as pal \gset
select tests.create_user('late@example.com') as late \gset
select tests.create_user('quiet@example.com') as quiet \gset

update public.profiles set steam_id = '76561197960265738' where id = :'pal';   -- account 10
update public.profiles set steam_id = '76561197960265758' where id = :'late';  -- account 30
insert into public.friendships (requester_id, addressee_id, status)
values (:'lead', :'pal', 'accepted'), (:'lead', :'late', 'accepted'), (:'lead', :'quiet', 'accepted');

-- A party of two plays an ended draft. The lead's account is hidden; they saw
-- suggestions for position 4, and hero 2 was entered at position 4.
select tests.sign_in_as('lead@example.com');
select public.start_party() as party \gset
select public.invite_to_party(:'pal');
select tests.sign_out();
select tests.sign_in_as('pal@example.com');
select public.answer_party_invite(:'party', true);
select public.start_party_draft() as draft \gset
select public.add_draft_action(:'draft', 'ally', 1::smallint, 1::smallint);
select public.add_draft_action(:'draft', 'ally', 2::smallint, 4::smallint);
select tests.sign_out();
select tests.sign_in_as('lead@example.com');
select public.save_draft_suggestions(:'draft', 4::smallint, '{2,3}', '{3,2}');
select public.end_party_draft(:'draft');
select tests.sign_out();

select is(public.attach_draft_match(:'draft', 42, true,
  '[{"account_id": 10, "hero_id": 1}, {"account_id": null, "hero_id": 2}]', 22::smallint, 7::smallint),
  true, 'the first attach wins');
select results_eq(format('select match_id, won from public.party_drafts where id = %L', :'draft'),
  $$values (42::bigint, true)$$, 'the draft has its match and result');
select results_eq(
  format('select user_id, hero_id::int, hero_source from public.draft_players where draft_id = %L order by user_id = %L', :'draft', :'pal'),
  format($$values (%L::uuid, 2, 'position'), (%L::uuid, 1, 'account')$$, :'lead', :'pal'),
  'heroes come from the account, or the pick at the shown position when hidden');
select results_eq(format('select match_id, status, game_mode::int, lobby_type::int from public.match_reports where draft_id = %L', :'draft'),
  $$values (42::bigint, 'waiting_parse', 22, 7)$$, 'a report is queued');

select is(public.attach_draft_match(:'draft', 43, false, '[]', 22::smallint, 7::smallint), false,
  'a second attach changes nothing');
select is((select match_id from public.party_drafts where id = :'draft'), 42::bigint, 'the first match stays');
select throws_ok(format($$select public.attach_draft_match(%L, 1, true, '{}', 1::smallint, 1::smallint)$$, :'draft'),
  '22023', null, 'players must be a list');

-- A draft nobody ended: members from when it opened, plus a later joiner whose account
-- played the match, but not a later joiner who didn't.
select tests.sign_in_as('pal@example.com');
select public.start_party_draft() as draft2 \gset
select tests.sign_out();
update public.party_members set joined_at = now() - interval '2 hours' where party_id = :'party';
update public.party_drafts set created_at = now() - interval '1 hour' where id = :'draft2';
select tests.sign_in_as('lead@example.com');
select public.invite_to_party(:'late');
select public.invite_to_party(:'quiet');
select tests.sign_out();
select tests.sign_in_as('late@example.com');
select public.answer_party_invite(:'party', true);
select tests.sign_out();
select tests.sign_in_as('quiet@example.com');
select public.answer_party_invite(:'party', true);
select tests.sign_out();

select is(public.attach_draft_match(:'draft2', 50, false,
  '[{"account_id": 30, "hero_id": 7}, {"account_id": 10, "hero_id": 8}]', 22::smallint, 7::smallint), true,
  'an open draft gets its match too');
select results_eq(
  format('select user_id from public.draft_players where draft_id = %L order by user_id', :'draft2'),
  format('select unnest(array[%L, %L, %L]::uuid[]) order by 1', :'lead', :'pal', :'late'),
  'its players are the starters plus the joiner who played');
select isnt((select ended_at from public.party_drafts where id = :'draft2'), null, 'and it is closed');

select tests.sign_in_as('lead@example.com');
select throws_ok(format($$select public.attach_draft_match(%L, 1, true, '[]', 1::smallint, 1::smallint)$$, :'draft'),
  '42501', null, 'users cannot attach matches');

select * from finish();
rollback;
