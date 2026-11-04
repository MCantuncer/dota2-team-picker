begin;
\ir _helpers.psql
select plan(5);

select tests.create_user('player@example.com') as player \gset
select tests.create_user('mate@example.com') as mate \gset
select tests.create_user('other@example.com') as other \gset

insert into public.parties (leader_id) values (:'player') returning id as party \gset

-- 1. The draft's match is known first, then the job saves the player's game.
insert into public.party_drafts (party_id, started_by, ended_at, match_id, won)
values (:'party', :'player', now() - interval '2 hours', 8100000001, true) returning id as first_draft \gset
insert into public.draft_players (draft_id, user_id) values (:'first_draft', :'player');
insert into public.player_game_facts (user_id, match_id, hero_id, is_win, started_at, duration_s)
values (:'player', 8100000001, 114, true, now() - interval '3 hours', 2400);
select is((select draft_id from public.player_game_facts where user_id = :'player' and match_id = 8100000001),
  :'first_draft'::uuid, 'a game saved after its draft links to it');

-- Someone who played the same match outside the draft is not linked.
insert into public.player_game_facts (user_id, match_id, hero_id, is_win, started_at, duration_s)
values (:'other', 8100000001, 8, false, now() - interval '3 hours', 2400);
select is((select draft_id from public.player_game_facts where user_id = :'other'), null,
  'a player outside the draft stays unlinked');

-- 2. The job saves the games first, then the draft's match is found.
insert into public.party_drafts (party_id, started_by, ended_at)
values (:'party', :'player', now() - interval '1 hour') returning id as second_draft \gset
insert into public.draft_players (draft_id, user_id) values (:'second_draft', :'player'), (:'second_draft', :'mate');
insert into public.player_game_facts (user_id, match_id, hero_id, is_win, started_at, duration_s)
values (:'player', 8100000002, 114, false, now() - interval '1 hour', 2400),
       (:'mate', 8100000002, 25, false, now() - interval '1 hour', 2400);
select is((select count(*)::int from public.player_game_facts where match_id = 8100000002 and draft_id is not null), 0,
  'no link before the match is known');
update public.party_drafts set match_id = 8100000002, won = false where id = :'second_draft';
select is((select count(*)::int from public.player_game_facts where match_id = 8100000002 and draft_id = :'second_draft'), 2,
  'every player in the draft is linked once the match is found');

-- The job's later upserts keep the link.
insert into public.player_game_facts (user_id, match_id, hero_id, is_win, started_at, duration_s, status, summary, summary_version)
values (:'mate', 8100000002, 25, false, now() - interval '1 hour', 2400, 'basic', '{}', 1)
on conflict (user_id, match_id) do update set status = excluded.status, summary = excluded.summary,
  summary_version = excluded.summary_version;
select is((select draft_id from public.player_game_facts where user_id = :'mate'), :'second_draft'::uuid,
  'an upsert keeps the link');

select * from finish();
rollback;
