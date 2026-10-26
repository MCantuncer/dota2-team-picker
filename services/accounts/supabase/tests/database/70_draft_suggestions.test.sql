begin;
\ir _helpers.psql
select plan(8);

select tests.create_user('lead@example.com') as lead \gset
select tests.create_user('pal@example.com') as pal \gset
select tests.create_user('stranger@example.com') as stranger \gset

insert into public.friendships (requester_id, addressee_id, status) values (:'lead', :'pal', 'accepted');

-- A party of two with an open draft.
select tests.sign_in_as('lead@example.com');
select public.start_party() as party \gset
select public.invite_to_party(:'pal');
select tests.sign_out();
select tests.sign_in_as('pal@example.com');
select public.answer_party_invite(:'party', true);
select public.start_party_draft() as draft \gset

select lives_ok(format($$select public.save_draft_suggestions(%L, 5::smallint, '{5,6}', '{3.5,2.0}', 0.52)$$, :'draft'),
  'a member saves the list they see');
-- Back-date the first list, so a second save shows it keeps first_shown_at.
reset role;
update public.draft_suggestions set first_shown_at = now() - interval '20 seconds';
select tests.sign_in_as('pal@example.com');
select lives_ok(format($$select public.save_draft_suggestions(%L, 5::smallint, '{7,5,6}', '{4,3.5,2}')$$, :'draft'),
  'a later list replaces it');

select tests.sign_out();
select tests.sign_in_as('lead@example.com');
select results_eq(
  format('select position::int, heroes::int[], win_chance, first_shown_at < updated_at from public.draft_suggestions where draft_id = %L', :'draft'),
  $$values (5, '{7,5,6}'::int[], null::real, true)$$,
  'the party sees the latest list, and when the first was shown');

select throws_ok(format($$select public.save_draft_suggestions(%L, 1::smallint, '{1,2}', '{1}')$$, :'draft'), '23514', null,
  'every hero needs a score');
select throws_ok(format($$select public.save_draft_suggestions(%L, 1::smallint, '{1,2,3,4,5,6,7,8,9}', '{1,1,1,1,1,1,1,1,1}')$$, :'draft'), '23514', null,
  'at most 8 heroes');
select throws_ok('insert into public.draft_suggestions (draft_id, user_id, position, heroes, scores) values (gen_random_uuid(), auth.uid(), 1, ''{1}'', ''{1}'')',
  '42501', null, 'the table cannot be written directly');

select tests.sign_out();
select tests.sign_in_as('stranger@example.com');
select is_empty('select * from public.draft_suggestions', 'someone outside the party sees nothing');
select throws_ok(format($$select public.save_draft_suggestions(%L, 1::smallint, '{1}', '{1}')$$, :'draft'), 'P0002', null,
  'someone outside the party cannot save to its draft');

select * from finish();
rollback;
