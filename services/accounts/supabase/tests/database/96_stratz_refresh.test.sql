begin;
\ir _helpers.psql
select plan(21);

select tests.create_user('player@example.com');

-- Free with nothing marked.
select is(public.stratz_free_at(), null, 'STRATZ is free when nothing is marked');

-- The refresh waits 15 minutes after the last lookup call, and the lookups wait while it runs.
select is(public.take_stratz_calls(5, 600), true, 'a lookup takes STRATZ calls');
select is((select last_lookup_at from public.stratz_refresh), now(), 'the call time is noted');
select is(public.mark_stratz_refresh(true), now() + interval '15 minutes',
  'the refresh starts its calls 15 minutes after the last lookup call');
select is((select finished_at from public.stratz_refresh), null, 'starting clears the finish');
select is(public.stratz_free_at(), now() + interval '15 minutes', 'a running refresh holds lookups back');
select is(public.take_stratz_calls(1, 600), false, 'no STRATZ calls are taken while it runs');

select lives_ok($$select public.mark_stratz_refresh(false)$$, 'the refresh is marked done');
select is((select (started_at, finished_at) from public.stratz_refresh), (now(), now()),
  'finishing keeps the start and sets the end');
select is(public.stratz_free_at(), now() + interval '15 minutes', 'lookups wait 15 minutes after the refresh');
update public.stratz_refresh set started_at = now() - interval '1 hour', finished_at = now() - interval '20 minutes';
select is(public.stratz_free_at(), null, 'and then they are free');

-- A killed job holds lookups back for 90 minutes at most.
update public.stratz_refresh set started_at = now() - interval '91 minutes', finished_at = null;
select is(public.stratz_free_at(), null, 'a start without an end counts for 90 minutes');
update public.stratz_refresh set last_lookup_at = now() - interval '1 hour';
select is(public.mark_stratz_refresh(true), now(), 'with no recent lookup the refresh starts at once');
select lives_ok($$select public.mark_stratz_refresh(false)$$, 'done again');
update public.stratz_refresh set started_at = now() - interval '2 hours', finished_at = now() - interval '1 hour';

-- A 429 holds every lookup back, for an hour at most.
select public.note_stratz_busy(now() + interval '5 minutes');
select is(public.stratz_free_at(), now() + interval '5 minutes', 'a 429 holds lookups back');
select public.note_stratz_busy(now() + interval '1 day');
select is(public.stratz_free_at(), now() + interval '1 hour', 'for at most an hour');

-- One row, and only the service role reaches it.
select throws_ok($$insert into public.stratz_refresh (id) values (false)$$, '23514', null, 'there is one row');
select tests.sign_in_as('player@example.com');
select throws_ok('select 1 from public.stratz_refresh', '42501', null, 'users cannot read the marks');
select throws_ok($$select public.mark_stratz_refresh(true)$$, '42501', null, 'users cannot mark the refresh');
select throws_ok($$select public.note_stratz_busy(now())$$, '42501', null, 'users cannot hold lookups back');
select throws_ok($$select public.stratz_free_at()$$, '42501', null, 'users cannot read when STRATZ is free');

select * from finish();
rollback;
