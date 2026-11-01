begin;
\ir _helpers.psql
select plan(9);

select tests.create_user('lead@example.com') as lead \gset
select tests.create_user('pal@example.com') as pal \gset
select tests.create_user('stranger@example.com') as stranger \gset

insert into public.friendships (requester_id, addressee_id, status) values (:'lead', :'pal', 'accepted');

-- A party of two plays a draft, and the job writes its report.
select tests.sign_in_as('lead@example.com');
select public.start_party() as party \gset
select public.invite_to_party(:'pal');
select tests.sign_out();
select tests.sign_in_as('pal@example.com');
select public.answer_party_invite(:'party', true);
select public.start_party_draft() as draft \gset
select public.end_party_draft(:'draft');
select tests.sign_out();

insert into public.match_reports (draft_id, match_id, status, facts, facts_version)
values (:'draft', 8012345678, 'basic', '{"duration": 2100}', 1);
insert into public.match_files (match_id, size_bytes) values (8012345678, 43000);

select throws_ok(
  format($$insert into public.match_reports (draft_id, match_id, status) values (%L, 1, 'ready')$$, :'draft'),
  '23514', null, 'a finished report has facts');
select throws_ok(
  $$insert into public.match_files (match_id, size_bytes) values (1, 0)$$,
  '23514', null, 'a saved file has a size');

-- Players read their report, even after leaving the party.
select tests.sign_in_as('pal@example.com');
select is((select (facts ->> 'duration')::int from public.match_reports where draft_id = :'draft'), 2100,
  'a player reads the report');
select public.leave_party();
select is((select count(*)::int from public.match_reports), 1, 'and still does after leaving the party');
select throws_ok('select * from public.match_files', '42501', null, 'players cannot list the saved files');
select throws_ok(format($$update public.match_reports set status = 'failed' where draft_id = %L$$, :'draft'),
  '42501', null, 'players cannot change a report');

select tests.sign_out();
select tests.sign_in_as('stranger@example.com');
select is_empty('select * from public.match_reports', 'others cannot read the report');

select tests.sign_out();
select is((select public from storage.buckets where id = 'match-data'), false, 'the raw match bucket is private');
select is_empty($$select * from pg_policies where schemaname = 'storage' and qual like '%match-data%'$$,
  'and has no access policies');

select * from finish();
rollback;
