begin;
\ir _helpers.psql
select plan(21);

select tests.create_user('lead@example.com') as lead \gset
select tests.create_user('pal@example.com') as pal \gset
select tests.create_user('solo@example.com') as solo \gset
select tests.create_user('nosteam@example.com') as nosteam \gset
update public.profiles set steam_id = '76561197960265829' where id = :'lead';
update public.profiles set steam_id = '76561197960265830' where id = :'pal';
update public.profiles set steam_id = '76561197960265831' where id = :'solo';

-- A party with an open draft holding all 10 heroes.
insert into public.friendships (requester_id, addressee_id, status) values (:'lead', :'pal', 'accepted');
select tests.sign_in_as('lead@example.com');
select public.start_party() as party \gset
select public.invite_to_party(:'pal');
select tests.sign_out();
select tests.sign_in_as('pal@example.com');
select public.answer_party_invite(:'party', true);
select tests.sign_out();
select tests.sign_in_as('lead@example.com');
select public.start_party_draft() as draft \gset
select public.add_draft_action(:'draft', 'ally', h::smallint) from generate_series(21, 25) h;
select public.add_draft_action(:'draft', 'enemy', h::smallint) from generate_series(31, 34) h;
select tests.sign_out();

-- Open drafts.
select is_empty('select * from public.claim_unattached_drafts()', 'an open draft with 9 heroes is not looked up');
select tests.sign_in_as('lead@example.com');
select public.add_draft_action(:'draft', 'enemy', 35::smallint);
select tests.sign_out();
select is_empty('select * from public.claim_unattached_drafts()', 'nor a full one entered a moment ago');
update public.draft_actions set created_at = now() - interval '30 minutes' where draft_id = :'draft';
select results_eq(
  'select draft_id, allies::int[], account_ids from public.claim_unattached_drafts()',
  format($$values (%L::uuid, '{21,22,23,24,25}'::int[], '{101,102}'::bigint[])$$, :'draft'),
  'a full open draft 30 minutes on is looked up with its members'' Steam accounts');
select is_empty('select * from public.claim_unattached_drafts()', 'and not again until its next gap');
update public.party_drafts set result_checked_at = now() - interval '11 minutes' where id = :'draft';
select is((select count(*)::int from public.claim_unattached_drafts()), 1, 'it is tried again after the gap');
update public.draft_actions set created_at = now() - interval '7 hours' where draft_id = :'draft';
update public.party_drafts set result_checked_at = now() - interval '1 hour' where id = :'draft';
select is_empty('select * from public.claim_unattached_drafts()', 'an open draft idle for over 6 hours is left alone');

-- Solo boards.
select tests.sign_in_as('solo@example.com');
select public.save_game_check_in(gen_random_uuid(), null, '{1,2,3,4,5}', null, '{6,7,8,9,10}', null, 2::smallint, 2::smallint, null, true) as game \gset
select is(public.set_game_started(:'game', true) is not null, true, 'Start Game marks the board started');
select tests.sign_out();
select is_empty('select * from public.claim_solo_check_ins()', 'a game started a moment ago is not looked up yet');
update public.game_check_ins set started_at = now() - interval '30 minutes' where id = :'game';
select results_eq(
  'select id, account_id, allies::int[], my_hero::int from public.claim_solo_check_ins()',
  format($$values (%L::uuid, 103::bigint, '{1,2,3,4,5}'::int[], 2)$$, :'game'),
  'a game started 30 minutes ago is looked up with the player''s account');
select is_empty('select * from public.claim_solo_check_ins()', 'and not again until its next gap');

select tests.sign_in_as('solo@example.com');
select public.save_game_check_in(gen_random_uuid(), null, '{1,2,3,4,5}', null, '{6,7,8,9,10}', null, 2::smallint, null, null, false) as unstarted \gset
select tests.sign_out();
update public.game_check_ins set filled_at = now() - interval '1 hour' where id = :'unstarted';
select is_empty(format('select * from public.claim_solo_check_ins() where id = %L', :'unstarted'), 'a board never started is never looked up');

-- Only each player's 3 newest started boards of the day.
insert into public.game_check_ins (user_id, client_key, allies, ally_positions, enemies, my_position, started_at)
select :'solo', gen_random_uuid(), '{1,2,3,4,5}', '{0,0,0,0,0}', '{6,7,8,9,10}', 1, now() - interval '25 minutes' - n * interval '1 minute'
from generate_series(1, 3) n;
select is((select count(*)::int from public.claim_solo_check_ins(10)), 3, 'only the 3 newest started boards are looked up');

-- Players without Steam, skipped boards and hidden profiles.
insert into public.game_check_ins (user_id, client_key, allies, ally_positions, enemies, my_position, started_at)
values (:'nosteam', gen_random_uuid(), '{1,2,3,4,5}', '{0,0,0,0,0}', '{6,7,8,9,10}', 1, now() - interval '30 minutes');
select is_empty('select * from public.claim_solo_check_ins(10)', 'players without Steam are never looked up');

-- Results.
select is(public.set_check_in_result(:'game', 8012345678, true), true, 'the job saves the game it found');
select is(public.set_check_in_result(:'game', 8012345679, false), false, 'a found game is never replaced');
select results_eq(format('select match_id, won from public.game_check_ins where id = %L', :'game'),
  $$values (8012345678::bigint, true)$$, 'the first result stays');

select public.note_check_in_no_games(:'unstarted');
select is((select profile_hidden from public.game_check_ins where id = :'unstarted'), false, 'one empty search is not enough to call a profile hidden');
select public.note_check_in_no_games(:'unstarted');
select is((select profile_hidden from public.game_check_ins where id = :'unstarted'), true, 'two empty searches mark it hidden');

-- Only the player starts their own game, and only the job may claim.
select tests.sign_in_as('nosteam@example.com');
select throws_ok(format('select public.set_game_started(%L, false)', :'unstarted'), 'P0002', null,
  'nobody else can start or clear your game');
select throws_ok('select * from public.claim_solo_check_ins()', '42501', null, 'players cannot claim boards');
select tests.sign_out();

update public.game_check_ins set filled_at = now() - interval '181 days' where id = :'unstarted';
select is(public.forget_old_check_ins(), 1, 'check-ins older than 180 days are deleted');

select * from finish();
rollback;
