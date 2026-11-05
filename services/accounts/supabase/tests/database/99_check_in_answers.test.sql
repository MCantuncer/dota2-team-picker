begin;
\ir _helpers.psql
select plan(21);

select tests.create_user('steam@example.com') as steam \gset
select tests.create_user('plain@example.com') as plain \gset
update public.profiles set steam_id = '76561197960265829' where id = :'steam';

-- Each player has one started game; the Steam player's has a Game Story.
reset role;
insert into public.game_check_ins (id, user_id, client_key, allies, ally_positions, enemies, my_position, my_hero, story_shown, started_at)
values
  ('b0000000-0000-4000-8000-000000000001', :'steam', gen_random_uuid(), '{1,2,3,4,5}', '{0,0,0,0,0}', '{6,7,8,9,10}', 2, 2, true, now() - interval '30 minutes'),
  ('b0000000-0000-4000-8000-000000000002', :'plain', gen_random_uuid(), '{1,2,3,4,5}', '{0,0,0,0,0}', '{6,7,8,9,10}', 2, null, false, now() - interval '70 minutes');

select tests.sign_in_as('steam@example.com');
select is((select id from public.due_check_in('draft')), 'b0000000-0000-4000-8000-000000000001'::uuid,
  'back on the Draft page 30 minutes after the start, the game is asked about');
select is_empty($$select * from public.due_check_in('site')$$,
  'elsewhere on the site a Steam player waits for the result');
select throws_ok($$select * from public.due_check_in('home')$$, '22023', null, 'only the two surfaces are known');
select tests.sign_out();

reset role;
select public.set_check_in_result('b0000000-0000-4000-8000-000000000001', 8012345678, true);
select tests.sign_in_as('steam@example.com');
select results_eq($$select match_id, won from public.due_check_in('site')$$, $$values (8012345678::bigint, true)$$,
  'once the result is found it is asked about anywhere, with the result');
select lives_ok($$select public.answer_check_in('b0000000-0000-4000-8000-000000000001', true, false, 'good', 'partly', '{laning,late_game,laning}', '  their Pudge roamed  ')$$,
  'the player answers');
select results_eq(
  $$select won, player_won, picks_feel, story_feel, tags, note from public.game_check_ins where id = 'b0000000-0000-4000-8000-000000000001'$$,
  $$values (true, null::boolean, 'good', 'partly', '{laning,late_game}'::text[], 'their Pudge roamed')$$,
  'the found result stays, and the answers are saved tidied');
select is_empty($$select * from public.due_check_in('draft')$$, 'an answered game is not asked again');
select throws_ok($$select public.answer_check_in('b0000000-0000-4000-8000-000000000001', true, true)$$, '55000', null,
  'nor answered twice');
select tests.sign_out();

-- A player without Steam.
select tests.sign_in_as('plain@example.com');
select is((select id from public.due_check_in('site')), 'b0000000-0000-4000-8000-000000000002'::uuid,
  'without Steam the site asks 60 minutes after the start');
select throws_ok($$select public.answer_check_in('b0000000-0000-4000-8000-000000000002')$$, '22023', 'Tell us if you won or lost',
  'with no result the player says who won');
select throws_ok($$select public.answer_check_in('b0000000-0000-4000-8000-000000000002', true, true, null, 'helped')$$, '22023', null,
  'no Story answer for a game without a Story');
select throws_ok($$select public.answer_check_in('b0000000-0000-4000-8000-000000000002', true, true, null, null, '{feelings}')$$, '23514', null,
  'only the known tags');
select throws_ok($$select public.answer_check_in('b0000000-0000-4000-8000-000000000001', true, true)$$, 'P0002', null,
  'nobody answers someone else''s game');
select public.snooze_check_in('b0000000-0000-4000-8000-000000000002');
select is_empty($$select * from public.due_check_in('site')$$, 'Not Now hides it for a while');
reset role;
update public.game_check_ins set snoozed_until = now() - interval '1 minute' where id = 'b0000000-0000-4000-8000-000000000002';
select tests.sign_in_as('plain@example.com');
select public.snooze_check_in('b0000000-0000-4000-8000-000000000002');
reset role;
update public.game_check_ins set snoozed_until = now() - interval '1 minute' where id = 'b0000000-0000-4000-8000-000000000002';
select tests.sign_in_as('plain@example.com');
select is_empty($$select * from public.due_check_in('site')$$, 'after two Not Nows the site stops asking');
select isnt_empty($$select * from public.due_check_in('draft')$$, 'but the Draft page still does');
select lives_ok($$select public.answer_check_in('b0000000-0000-4000-8000-000000000002', false)$$, 'Didn''t Play It closes it');
select results_eq($$select played, answered_at is not null from public.game_check_ins where id = 'b0000000-0000-4000-8000-000000000002'$$,
  $$values (false, true)$$, 'saved as not played');
select tests.sign_out();

-- Skip.
reset role;
insert into public.game_check_ins (id, user_id, client_key, allies, ally_positions, enemies, my_position, started_at)
values ('b0000000-0000-4000-8000-000000000003', :'plain', gen_random_uuid(), '{1,2,3,4,5}', '{0,0,0,0,0}', '{6,7,8,9,10}', 1, now() - interval '2 hours');
select tests.sign_in_as('plain@example.com');
select public.skip_check_in('b0000000-0000-4000-8000-000000000003');
select is_empty($$select * from public.due_check_in('draft')$$, 'a skipped game is never asked');

-- A party board takes its draft's result only for players saved as playing it.
select tests.sign_out();
reset role;
insert into public.friendships (requester_id, addressee_id, status) values (:'steam', :'plain', 'accepted');
select tests.sign_in_as('steam@example.com');
select public.start_party() as party \gset
select public.invite_to_party(:'plain');
select tests.sign_out();
select tests.sign_in_as('plain@example.com');
select public.answer_party_invite(:'party', true);
select public.start_party_draft() as draft \gset
select tests.sign_out();
reset role;
update public.party_drafts set match_id = 8012345680, won = false, ended_at = now() where id = :'draft';
insert into public.draft_players (draft_id, user_id) values (:'draft', :'steam');
insert into public.game_check_ins (user_id, party_draft_id, allies, ally_positions, enemies, my_position, started_at)
values
  (:'steam', :'draft', '{1,2,3,4,5}', '{0,0,0,0,0}', '{6,7,8,9,10}', 1, now() - interval '5 minutes'),
  (:'plain', :'draft', '{1,2,3,4,5}', '{0,0,0,0,0}', '{6,7,8,9,10}', 1, now() - interval '5 minutes');
select tests.sign_in_as('steam@example.com');
select results_eq($$select match_id, won from public.due_check_in('site')$$, $$values (8012345680::bigint, false)$$,
  'a player of the party draft gets its result');
select tests.sign_out();
select tests.sign_in_as('plain@example.com');
select is_empty($$select * from public.due_check_in('site') where match_id is not null$$,
  'a member who wasn''t saved as playing it does not');

select * from finish();
rollback;
