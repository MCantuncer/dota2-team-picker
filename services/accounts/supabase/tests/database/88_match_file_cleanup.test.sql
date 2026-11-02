begin;
\ir _helpers.psql
select plan(6);

select tests.create_user('lead@example.com') as lead \gset
select tests.sign_in_as('lead@example.com');
select public.start_party() as party \gset
select public.start_party_draft() as fresh \gset
select public.end_party_draft(:'fresh');
select public.start_party_draft() as old \gset
select public.end_party_draft(:'old');
select tests.sign_out();

-- Three saved matches: one with a report saved today, one with a report saved 91 days
-- ago, and one whose report is gone.
insert into public.match_reports (draft_id, match_id) values (:'fresh', 100), (:'old', 200);
insert into public.match_files (match_id, saved_at, size_bytes) values
  (100, now(), 40000),
  (200, now() - interval '91 days', 40000),
  (300, now() - interval '1 day', 40000);

select results_eq('select match_id from public.stale_match_files() order by match_id',
  $$values (200::bigint), (300::bigint)$$,
  'files past 90 days or without a report are stale');
select is((select count(*)::int from public.stale_match_files(1)), 1, 'max_rows caps the list');

select is(public.forget_match_files('{100,200,300}'), 2, 'only stale files are dropped from the list');
select results_eq('select match_id from public.match_files', $$values (100::bigint)$$,
  'the file a report still needs stays');

select tests.sign_in_as('lead@example.com');
select throws_ok('select public.stale_match_files()', '42501', null, 'users cannot list files');
select throws_ok($$select public.forget_match_files('{100}')$$, '42501', null, 'or drop them');

select * from finish();
rollback;
