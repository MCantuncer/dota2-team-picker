begin;
\ir _helpers.psql
select plan(7);

select tests.create_user('player@example.com');

select is(public.take_opendota_calls(3, 10), true, 'calls under the cap are taken');
select is(public.take_opendota_calls(7, 10), true, 'up to the cap exactly');
select is(public.take_opendota_calls(1, 10), false, 'one more is refused');
select is((select calls from public.opendota_calls), 10, 'a refused take takes nothing');
select is(public.take_opendota_calls(0, 10), false, 'a take of nothing is refused');
select is(public.take_opendota_calls(11, 10), false, 'more than a whole day is refused');

select tests.sign_in_as('player@example.com');
select throws_ok('select public.take_opendota_calls(1)', '42501', null, 'users cannot spend the budget');

select * from finish();
rollback;
