begin;
\ir _helpers.psql
select plan(7);

select tests.create_user('lead@example.com') as lead \gset
select tests.create_user('pal@example.com') as pal \gset
select tests.create_user('stranger@example.com') as stranger \gset
insert into public.friendships (requester_id, addressee_id, status) values (:'lead', :'pal', 'accepted');

-- Four games as a party of two.
select tests.sign_in_as('lead@example.com');
select public.start_party() as party \gset
select public.invite_to_party(:'pal');
select tests.sign_out();
select tests.sign_in_as('pal@example.com');
select public.answer_party_invite(:'party', true);
select tests.sign_out();
select tests.sign_in_as('lead@example.com');
select public.start_party_draft() as d1 \gset
select public.end_party_draft(:'d1');
select public.start_party_draft() as d2 \gset
select public.end_party_draft(:'d2');
select public.start_party_draft() as d3 \gset
select public.end_party_draft(:'d3');
select public.start_party_draft() as d4 \gset
select public.end_party_draft(:'d4');
select tests.sign_out();

-- Game 1 (Ranked All Pick, won): I picked hero 1, second in my list. The pal played 2 at position 3.
-- Game 2 (Ranked All Pick, lost): I picked hero 5, not in my list.
-- Game 3 (Turbo, won): left out of every record.
-- Game 4 (All Pick, won): I had no list; the pal's position is unknown.
insert into public.draft_actions (draft_id, actor_id, kind, hero_id, created_at) values
  (:'d1', :'lead', 'ally', 1, now() + interval '1 minute'),
  (:'d2', :'lead', 'ally', 5, now() + interval '1 minute'),
  (:'d3', :'lead', 'ally', 1, now() + interval '1 minute');
insert into public.draft_suggestions (draft_id, user_id, position, heroes, scores) values
  (:'d1', :'lead', 1, '{4,1,7}', '{3,2,1}'),
  (:'d2', :'lead', 1, '{4,1,7}', '{3,2,1}'),
  (:'d3', :'lead', 1, '{1}', '{1}');
update public.draft_players set position = 1 where user_id = :'lead';
update public.draft_players set position = case when draft_id = :'d4' then null else 3 end where user_id = :'pal';
update public.draft_players set hero_id = 1, hero_source = 'position' where user_id = :'lead' and draft_id in (:'d1', :'d3');
update public.draft_players set hero_id = 5, hero_source = 'position' where user_id = :'lead' and draft_id = :'d2';
update public.draft_players set hero_id = 9, hero_source = 'position' where user_id = :'lead' and draft_id = :'d4';
update public.party_drafts set won = id in (:'d1', :'d3', :'d4'),
  match_id = case id when :'d1' then 1 when :'d2' then 2 when :'d3' then 3 else 4 end
where id in (:'d1', :'d2', :'d3', :'d4');
insert into public.match_reports (draft_id, match_id, game_mode) values
  (:'d1', 1, 22), (:'d2', 2, 22), (:'d3', 3, 23), (:'d4', 4, 1);

select tests.sign_in_as('lead@example.com');
select results_eq('select bucket, games, wins from public.my_suggestion_record()',
  $$values ('top3', 1, 1), ('in8', 0, 0), ('not_shown', 1, 0), ('no_list', 1, 1)$$,
  'games and wins by where my pick was in my list, Turbo left out');
select results_eq('select teammate_id, teammate_name, my_position::int, their_position::int, games, wins from public.my_pair_records()',
  format($$values (%L::uuid, 'pal', null::int, null::int, 3, 2), (%L::uuid, 'pal', 1, 3, 2, 1)$$, :'pal', :'pal'),
  'a teammate''s total, and by our positions only when both are known');
select throws_ok('select public.my_record_games()', '42501', null, 'the building block is not called directly');

-- The pal sees their own side of the same games.
select tests.sign_out();
select tests.sign_in_as('pal@example.com');
select results_eq('select bucket, games from public.my_suggestion_record()',
  $$values ('top3', 0), ('in8', 0), ('not_shown', 0), ('no_list', 3)$$,
  'a player with no list and no known hero counts as no list');
select is((select games from public.my_pair_records() where my_position is null), 3, 'and has the same pair total');

-- Someone who never played with them sees nothing.
select tests.sign_out();
select tests.sign_in_as('stranger@example.com');
select is((select sum(games)::int from public.my_suggestion_record()), 0, 'others have no games');
select is_empty('select * from public.my_pair_records()', 'and no teammates');

select * from finish();
rollback;
