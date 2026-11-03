begin;
\ir _helpers.psql
select plan(16);

select tests.create_user('active@example.com') as active \gset
select tests.create_user('idle@example.com') as idle \gset
select tests.create_user('email@example.com') as email_only \gset
select tests.create_user('stopped@example.com') as stopped \gset

update public.profiles set steam_id = '76561197960265738', last_active_at = now(), hero_stats = '{"114": {"games": 3, "wins": 2}}'
where id = :'active';
update public.profiles set steam_id = '76561197960265739', last_active_at = now() - interval '20 days' where id = :'idle';
update public.profiles set last_active_at = now() where id = :'email_only';
update public.profiles set steam_id = '76561197960265740', last_active_at = now(), pool_suggestions_off = true
where id = :'stopped';

insert into public.favorite_heroes (user_id, position, hero_id) values (:'active', 1, 1);
-- Lion pos 5 was declined 40 days ago and has 3 strong wins since: it may come back.
-- Pudge pos 4 was declined 40 days ago with only 1 strong win since: it waits.
insert into public.pool_suggestions (user_id, hero_id, position, status, question, reason, evidence, declined_at,
  created_at)
values (:'active', 26, 5, 'declined', 'q', 'r', '{}', now() - interval '40 days', now() - interval '41 days'),
  (:'active', 14, 4, 'declined', 'q', 'r', '{}', now() - interval '40 days', now() - interval '41 days');
insert into public.player_games (user_id, match_id, hero_id, position, position_source, is_win, is_strong, started_at,
  game_mode, lobby_type)
select :'active', n, 26, 5, 'stratz', true, true, now() - interval '5 days', 22, 7 from generate_series(1, 3) n;
insert into public.player_games (user_id, match_id, hero_id, position, position_source, is_win, is_strong, started_at,
  game_mode, lobby_type)
values (:'active', 9, 14, 4, 'stratz', true, true, now() - interval '5 days', 22, 7);

select results_eq(
  'select user_id, account_id, pool, skip, has_recent_card from public.claim_trend_players()',
  format($$values (%L::uuid, 10::bigint, '[{"heroId": 1, "position": 1}]'::jsonb, '{14:4}'::text[], false)$$, :'active'),
  'only active Steam players with cards on come, with their pool and the pairs to skip');
select is_empty('select * from public.claim_trend_players()', 'a claimed player waits 12 hours');
select throws_ok('select * from public.claim_trend_players(0)', '22023', null, 'the batch size is checked');

-- Saving a check: games, a new card, and closing cards that no longer qualify.
insert into public.pool_suggestions (user_id, hero_id, position, question, reason, evidence)
values (:'active', 2, 3, 'q', 'r', '{}') returning id as stale \gset
select public.save_trend_check(:'active', 'ok',
  '[{"match_id": 100, "hero_id": 114, "position": 1, "position_source": "opendota", "is_win": true,
     "is_strong": true, "started_at": "2026-11-01T10:00:00Z", "game_mode": 22, "lobby_type": 7},
    {"match_id": 101, "hero_id": 114, "position": null, "position_source": null, "is_win": false,
     "is_strong": null, "started_at": "2026-11-01T11:00:00Z", "game_mode": 1, "lobby_type": 0}]',
  '{"heroId": 114, "position": 1, "question": "Add Monkey King to your carry heroes?", "reason": "You won.",
    "evidence": {"games": 5}}',
  '{114:1}');
select is((select count(*)::int from public.player_games where user_id = :'active' and match_id in (100, 101)), 2,
  'games are saved');
select is((select status from public.pool_suggestions where hero_id = 114), 'open', 'the new card opens');
select is((select status from public.pool_suggestions where id = :'stale'), 'expired',
  'an open card that no longer qualifies closes');

-- Saving again updates games and never opens a second live card.
select public.save_trend_check(:'active', 'ok',
  '[{"match_id": 100, "hero_id": 114, "position": 1, "position_source": "stratz", "is_win": true,
     "is_strong": false, "imp": 5, "started_at": "2026-11-01T10:00:00Z", "game_mode": 22, "lobby_type": 7}]',
  '{"heroId": 114, "position": 1, "question": "q2", "reason": "r2", "evidence": {}}', '{114:1}');
select is((select position_source from public.player_games where match_id = 100), 'stratz', 'a game is updated');
select is((select count(*)::int from public.pool_suggestions where hero_id = 114), 1, 'one live card per pair');
select is((select question from public.pool_suggestions where hero_id = 114), 'Add Monkey King to your carry heroes?',
  'and the first card keeps its words');

-- Old games are purged, and a card open 14 days closes.
insert into public.player_games (user_id, match_id, hero_id, is_win, started_at, game_mode, lobby_type)
values (:'active', 200, 1, true, now() - interval '61 days', 22, 7);
update public.pool_suggestions set created_at = now() - interval '15 days' where hero_id = 114;
select public.save_trend_check(:'active', 'ok', '[]', null, '{114:1}');
select is((select count(*)::int from public.player_games where match_id = 200), 0, 'games older than 60 days go');
select is((select status from public.pool_suggestions where hero_id = 114), 'expired', 'cards open 14 days close');

-- A hidden profile keeps everything.
insert into public.pool_suggestions (user_id, hero_id, position, question, reason, evidence)
values (:'active', 5, 5, 'q', 'r', '{}');
select public.save_trend_check(:'active', 'hidden', '[]', null, '{}');
select is((select trends_state from public.profiles where id = :'active'), 'hidden', 'the state is saved');
select is((select status from public.pool_suggestions where hero_id = 5), 'open', 'and open cards stay');
select throws_ok(format($$select public.save_trend_check(%L, 'odd', '[]', null, '{}')$$, :'active'), '22023', null,
  'only known states');

-- Only the job may call these.
select tests.sign_in_as('active@example.com');
select throws_ok('select * from public.claim_trend_players()', '42501', null, 'players cannot claim checks');
select throws_ok(format($$select public.save_trend_check(%L, 'ok', '[]', null, '{}')$$, :'active'), '42501', null,
  'or save them');

select * from finish();
rollback;
