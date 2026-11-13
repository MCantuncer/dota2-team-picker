begin;
\ir _helpers.psql
select plan(15);

select tests.create_user('lead@example.com') as lead \gset
select tests.create_user('pal@example.com') as pal \gset
select tests.create_user('mert@example.com') as mert \gset
select tests.create_user('outsider@example.com') as outsider \gset

-- pal joins the party; mert is seated but never opens the site.
update public.profiles set steam_id = '76561197960265738' where id = :'pal';   -- account 10
update public.profiles set steam_id = '76561197960265748' where id = :'mert';  -- account 20
insert into public.friendships (requester_id, addressee_id, status)
values (:'lead', :'pal', 'accepted'), (:'lead', :'mert', 'accepted');

select tests.sign_in_as('lead@example.com');
select public.start_party() as party \gset
select public.invite_to_party(:'pal', 2::smallint);
select public.invite_to_party(:'mert', 3::smallint);
select tests.sign_out();
select tests.sign_in_as('pal@example.com');
select public.answer_party_invite(:'party', true);
select tests.sign_out();

-- The board typed before the party moves into its new draft, all or nothing.
select tests.sign_in_as('lead@example.com');
select public.start_party_draft() as draft \gset
select throws_ok(format($$select public.copy_board_to_party_draft(%L, '{}')$$, :'draft'), '22023', null,
  'the board must be a list');
select throws_ok(format($$select public.copy_board_to_party_draft(%L, '[{"kind": "pick", "hero_id": 1}]')$$, :'draft'),
  '22023', null, 'each entry is an ally, enemy or ban');
select throws_ok(
  format($$select public.copy_board_to_party_draft(%L, '[{"kind": "ally", "hero_id": 1, "position": 1}, {"kind": "enemy", "hero_id": 1}]')$$, :'draft'),
  '23505', null, 'a hero entered twice is refused');
select is_empty(format('select 1 from public.draft_actions where draft_id = %L', :'draft'), 'and nothing is copied');
select tests.sign_out();

select tests.sign_in_as('outsider@example.com');
select throws_ok(format($$select public.copy_board_to_party_draft(%L, '[]')$$, :'draft'), 'P0002', null,
  'outsiders cannot copy into the draft');
select tests.sign_out();
select tests.sign_in_as('pal@example.com');
select public.become_captain();
select tests.sign_out();
select tests.sign_in_as('lead@example.com');
select throws_ok(format($$select public.copy_board_to_party_draft(%L, '[{"kind": "ban", "hero_id": 9}]')$$, :'draft'),
  '42501', null, 'only the planner copies the board');
select tests.sign_out();
select tests.sign_in_as('pal@example.com');
select public.step_down_captain();
select tests.sign_out();

select tests.sign_in_as('lead@example.com');
select public.copy_board_to_party_draft(:'draft', (
  select jsonb_agg(e) from (
    select jsonb_build_object('kind', 'ally', 'hero_id', h, 'position', h) as e from generate_series(1, 5) h
    union all
    select jsonb_build_object('kind', 'enemy', 'hero_id', 10 + h, 'position', h) from generate_series(1, 5) h
    union all
    select jsonb_build_object('kind', 'ban', 'hero_id', 20, 'position', null)
  ) x
));
select results_eq(format('select kind, count(*)::int, count(position)::int from public.draft_state(%L) group by kind order by kind', :'draft'),
  $$values ('ally', 5, 5), ('ban', 1, 0), ('enemy', 5, 5)$$, 'picks, positions and bans are copied');
select throws_ok(format($$select public.copy_board_to_party_draft(%L, '[{"kind": "ban", "hero_id": 30}]')$$, :'draft'),
  '23505', null, 'a draft that already has heroes is not copied into');
select tests.sign_out();

-- An open draft that went quiet: the job searches the members' and seated players' accounts.
update public.draft_actions set created_at = now() - interval '30 minutes' where draft_id = :'draft';
select results_eq(format('select account_ids from public.claim_unattached_drafts() where draft_id = %L', :'draft'),
  $$values ('{10,20}'::bigint[])$$, 'an open draft searches members and seated players');

-- The draft ends: mert is saved for the search only.
select tests.sign_in_as('lead@example.com');
select public.end_party_draft(:'draft');
select tests.sign_out();
select results_eq(format('select user_id from public.draft_players where draft_id = %L order by user_id = %L', :'draft', :'pal'),
  format($$values (%L::uuid), (%L::uuid)$$, :'lead', :'pal'), 'only members are saved as players');
select results_eq(format('select account_id from public.draft_search_accounts where draft_id = %L', :'draft'),
  $$values (20::bigint)$$, 'the seated player''s account is saved for the search');

-- After the seat goes, the saved accounts are still searched.
select tests.sign_in_as('lead@example.com');
select public.unseat_player(:'mert');
select tests.sign_out();
update public.party_drafts set find_tries = 0, result_checked_at = null where id = :'draft';
select results_eq(format('select account_ids from public.claim_unattached_drafts() where draft_id = %L', :'draft'),
  $$values ('{10,20}'::bigint[])$$, 'an ended draft searches its saved players and seated accounts');

-- A seated player who never joined gets no access to the draft or its report.
select tests.sign_in_as('mert@example.com');
select is_empty(format('select 1 from public.party_drafts where id = %L', :'draft'), 'the seated player cannot read the draft');
select is_empty(format('select 1 from public.draft_players where draft_id = %L', :'draft'), 'or its players');
select throws_ok('select 1 from public.draft_search_accounts', '42501', null, 'nobody signed in reads the search accounts');
select tests.sign_out();

select * from finish();
rollback;
