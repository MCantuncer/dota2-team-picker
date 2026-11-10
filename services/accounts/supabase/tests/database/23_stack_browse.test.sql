begin;
\ir _helpers.psql
select plan(17);

select tests.create_user('a@example.com') as a \gset
select tests.create_user('b@example.com') as b \gset
select tests.create_user('c@example.com') as c \gset
select tests.create_user('d@example.com') as d \gset
select tests.create_user('out@example.com') as out \gset
update public.profiles set display_name = 'Ana', avatar_url = 'https://avatars.steamstatic.com/ana_full.jpg' where id = :'a';
-- Night Owls ranks: Legend 4 (54), Ancient 2 (62), no rank: steps 23 and 26 average to 24.5, rounded to 25 (Ancient 1, 61).
update public.profiles set rank_tier = 54 where id = :'a';
update public.profiles set rank_tier = 62 where id = :'b';
-- Duo 100%: only d has a rank, Immortal.
update public.profiles set rank_tier = 80 where id = :'d';

-- Three Stacks: Night Owls (open, 3 players), Duo 100% (open, 2 players), Secret (closed).
insert into public.teams (owner_id, name, open_to_requests) values (:'a', 'Night Owls', true) returning id as owls \gset
insert into public.teams (owner_id, name, open_to_requests) values (:'c', 'Duo 100%', true) returning id as duo \gset
insert into public.teams (owner_id, name, open_to_requests) values (:'d', 'Secret', false) returning id as secret \gset
insert into public.team_members (team_id, user_id) values (:'owls', :'b'), (:'owls', :'c'), (:'duo', :'d');
insert into public.favorite_heroes (user_id, position, hero_id) values (:'b', 1, 8);

-- Party drafts: two hours apart with all three owls and a match (2 games), one more in the same hour
-- (no extra game), one without a match (no game), one with only two owls (no game), and an old one.
insert into public.parties (leader_id) values (:'a') returning id as party \gset
create temp table drafts (n int, at timestamptz, match bigint, players uuid[]);
insert into drafts values
  (1, date_trunc('hour', now()) - interval '5 hours' + interval '10 minutes', 101, array[:'a', :'b', :'c']::uuid[]),
  (2, date_trunc('hour', now()) - interval '3 hours' + interval '10 minutes', 102, array[:'a', :'b', :'c']::uuid[]),
  (3, date_trunc('hour', now()) - interval '3 hours' + interval '40 minutes', 103, array[:'a', :'b', :'c']::uuid[]),
  (4, now() - interval '30 minutes', null, array[:'a', :'b', :'c']::uuid[]),
  (5, now() - interval '20 minutes', 105, array[:'a', :'b']::uuid[]),
  (6, now() - interval '20 days', 106, array[:'a', :'b', :'c']::uuid[]),
  (7, now() - interval '2 hours', 107, array[:'c', :'d']::uuid[]);
do $$
declare r record; new_id uuid;
begin
  for r in select * from drafts loop
    insert into public.party_drafts (party_id, started_by, created_at, ended_at, match_id, won)
    values ((select id from public.parties limit 1), r.players[1], r.at, r.at + interval '1 minute', r.match,
      case when r.match is null then null else true end)
    returning id into new_id;
    insert into public.draft_players (draft_id, user_id) select new_id, unnest(r.players);
  end loop;
end;
$$;

select tests.sign_in_as('out@example.com');
select results_eq('select name from public.browse_stacks()', array['Night Owls', 'Duo 100%'],
  'browse lists open stacks, most games together first');
select results_eq('select games from public.browse_stacks()', array[2, 1], 'games together count matched, spaced games');
select results_eq('select members from public.browse_stacks()', array[3, 2], 'member counts include the owner');
select is((select owner_name from public.browse_stacks() where name = 'Night Owls'), 'Ana', 'browse shows the owner name');
select is((select owner_avatar_url from public.browse_stacks() where name = 'Night Owls'),
  'https://avatars.steamstatic.com/ana_full.jpg', 'browse shows the owner avatar');
select results_eq('select average_rank from public.browse_stacks()', array[61, 80]::smallint[],
  'the average rank skips players without one; Immortal stays Immortal');
select results_eq('select average_rank from public.hot_stacks()', array[61, 80]::smallint[], 'hot stacks has it too');
select results_eq($$select name from public.browse_stacks('100%')$$, array['Duo 100%'], 'search matches % literally');
select is_empty($$select 1 from public.browse_stacks('_ight')$$, 'search matches _ literally');
select is_empty('select 1 from public.browse_stacks(null, 1)', 'the second page is empty');
select results_eq('select name from public.hot_stacks()', array['Night Owls', 'Duo 100%'], 'hot stacks lists stacks with games');
select is((select name from public.stack_page(:'owls')), 'Night Owls', 'anyone opens an open stack''s page');
select is((select my_role from public.stack_page(:'owls')), null, 'an outsider has no role there');
select is_empty(format('select 1 from public.stack_page(%L)', :'secret'), 'a closed stack''s page is hidden from outsiders');
select is_empty(format('select 1 from public.stack_members(%L)', :'owls'), 'outsiders do not see who is in a stack');
select tests.sign_out();

select tests.sign_in_as('b@example.com');
select results_eq(format('select role from public.stack_members(%L)', :'owls'), array['owner', 'player', 'player'],
  'a member sees who is in the stack');
select tests.sign_out();

select tests.sign_in_as('d@example.com');
select is((select my_role from public.stack_page(:'secret')), 'owner', 'the owner opens their closed stack');
select tests.sign_out();

select * from finish();
rollback;
