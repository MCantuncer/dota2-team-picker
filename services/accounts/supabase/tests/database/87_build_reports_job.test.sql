begin;
\ir _helpers.psql
select plan(11);

select tests.create_user('lead@example.com') as lead \gset
select tests.create_user('pal@example.com') as pal \gset
update public.profiles set steam_id = '76561197960265738' where id = :'pal';
insert into public.friendships (requester_id, addressee_id, status) values (:'lead', :'pal', 'accepted');

-- A party of two plays a draft: heroes 1 and 2 for us, 3 taken back out, 9 for them.
select tests.sign_in_as('lead@example.com');
select public.start_party() as party \gset
select public.invite_to_party(:'pal');
select tests.sign_out();
select tests.sign_in_as('pal@example.com');
select public.answer_party_invite(:'party', true);
select public.start_party_draft() as draft \gset
select public.add_draft_action(:'draft', 'ally', 1::smallint);
select public.add_draft_action(:'draft', 'ally', 2::smallint);
select public.add_draft_action(:'draft', 'ally', 3::smallint);
select public.add_draft_action(:'draft', 'remove', 3::smallint);
select public.add_draft_action(:'draft', 'enemy', 9::smallint);
select public.end_party_draft(:'draft');
-- A second draft where nobody has Steam linked is left alone.
select tests.sign_out();
select tests.sign_in_as('lead@example.com');
select public.start_party_draft() as no_steam \gset
select public.add_draft_action(:'no_steam', 'ally', 4::smallint);
select tests.sign_out();
update public.profiles set steam_id = null where id = :'pal';
select tests.sign_in_as('lead@example.com');
select public.end_party_draft(:'no_steam');
select tests.sign_out();

select results_eq(
  'select draft_id, allies::int[], account_ids from public.claim_unattached_drafts()',
  format($$values (%L::uuid, '{1,2}'::int[], '{10}'::bigint[])$$, :'draft'),
  'an ended draft with no match comes with our heroes and the Steam accounts');
select is((select find_tries::int from public.party_drafts where id = :'draft'), 1, 'and counts the try');
select is_empty('select * from public.claim_unattached_drafts()', 'the next try waits 10 minutes');

update public.party_drafts set result_checked_at = now() - interval '10 minutes' where id = :'draft';
select is((select count(*)::int from public.claim_unattached_drafts()), 1, 'then it is tried again');
update public.party_drafts set result_checked_at = now() - interval '15 minutes' where id = :'draft';
select is_empty('select * from public.claim_unattached_drafts()', 'the gap after that is 20 minutes');

update public.party_drafts set find_tries = 6, result_checked_at = null where id = :'draft';
select is_empty('select * from public.claim_unattached_drafts()', 'six tries at most');
update public.party_drafts set find_tries = 0, ended_at = now() - interval '7 hours' where id = :'draft';
select is_empty('select * from public.claim_unattached_drafts()', 'only drafts of the last 6 hours');

select lives_ok('select public.run_build_reports()', 'the schedule does nothing until Vault has the URL and secret');
select vault.create_secret('http://localhost:54321/functions/v1/build-reports', 'build_reports_url');
select vault.create_secret('test-secret', 'build_reports_secret');
select public.run_build_reports();
select is((select count(*)::int from net.http_request_queue where url like '%/build-reports'), 1,
  'with both set it calls the function');
select is((select schedule from cron.job where jobname = 'build-reports'), '*/10 * * * *', 'it runs every 10 minutes');

select tests.sign_in_as('lead@example.com');
select throws_ok('select public.claim_unattached_drafts()', '42501', null, 'users cannot claim drafts');

select * from finish();
rollback;
