begin;
\ir _helpers.psql
select plan(10);

select tests.create_user('lead@example.com') as lead \gset
select tests.create_user('pal@example.com') as pal \gset
insert into public.friendships (requester_id, addressee_id, status) values (:'lead', :'pal', 'accepted');

-- A party of two drafts: the lead was shown a list before picking hero 1, the pal's list
-- was saved after their hero 2 was entered.
select tests.sign_in_as('lead@example.com');
select public.start_party() as party \gset
select public.invite_to_party(:'pal');
select tests.sign_out();
select tests.sign_in_as('pal@example.com');
select public.answer_party_invite(:'party', true);
select public.start_party_draft() as draft \gset
select public.save_draft_suggestions(:'draft', 3::smallint, '{2,5}', '{3,2}');
select tests.sign_out();
select tests.sign_in_as('lead@example.com');
select public.save_draft_suggestions(:'draft', 1::smallint, '{4,1,7}', '{3,2,1}');
select public.add_draft_action(:'draft', 'ally', 1::smallint, 1::smallint);
select public.add_draft_action(:'draft', 'ally', 2::smallint, 3::smallint);
select public.end_party_draft(:'draft');
select tests.sign_out();

update public.draft_actions set created_at = now() + interval '1 minute' where draft_id = :'draft' and hero_id = 1;
update public.draft_actions set created_at = now() - interval '1 minute' where draft_id = :'draft' and hero_id = 2;
update public.draft_players set hero_id = 1, hero_source = 'position' where user_id = :'lead';
update public.draft_players set hero_id = 2, hero_source = 'position' where user_id = :'pal';
update public.party_drafts set match_id = 8012345678, won = true where id = :'draft';

select results_eq(
  format('select hero_id::int, shown::int[] from public.report_draft_lists(%L)', :'draft'),
  $$values (1, '{4,1,7}'::int[]), (2, '{}'::int[])$$,
  'a list counts only when it was saved before the pick');

-- Three reports: one due, one not due yet, one finished.
select tests.sign_in_as('lead@example.com');
select public.start_party_draft() as draft2 \gset
select public.end_party_draft(:'draft2');
select public.start_party_draft() as draft3 \gset
select public.end_party_draft(:'draft3');
select tests.sign_out();
insert into public.match_reports (draft_id, match_id, next_try_at) values
  (:'draft', 8012345678, now() - interval '1 minute'),
  (:'draft2', 8012345679, now() + interval '10 minutes');
insert into public.match_reports (draft_id, match_id, status, facts, facts_version)
values (:'draft3', 8012345680, 'ready', '{}', 1);

select results_eq(
  'select draft_id, match_id, won, parse_requests::int, attempts::int from public.claim_match_reports()',
  format($$values (%L::uuid, 8012345678::bigint, true, 0, 0)$$, :'draft'),
  'a run claims the due report with the party''s result');
select ok((select lease_until > now() from public.match_reports where draft_id = :'draft'), 'and leases it');
select is_empty('select * from public.claim_match_reports()', 'a second run does not take a leased report');

update public.match_reports set lease_until = now() - interval '1 second' where draft_id = :'draft';
select is((select count(*)::int from public.claim_match_reports()), 1, 'a run out lease is taken again');

update public.match_reports set lease_until = null, next_try_at = now() - interval '1 minute';
select is((select count(*)::int from public.claim_match_reports(1)), 1, 'max_rows caps a run');
select throws_ok('select public.claim_match_reports(0)', '22023', null, 'a run claims at least one');
select throws_ok($$select public.claim_match_reports(10, interval '2 hours')$$, '22023', null,
  'a lease is at most 30 minutes');

select tests.sign_in_as('lead@example.com');
select throws_ok('select public.claim_match_reports()', '42501', null, 'users cannot claim reports');
select throws_ok(format('select public.report_draft_lists(%L)', :'draft'), '42501', null,
  'users cannot read lists through the job function');

select * from finish();
rollback;
