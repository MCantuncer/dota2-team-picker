-- The Friends page: for each accepted friend, whether they are in a party, and how the caller does
-- when they queue together. Read only, nothing new is stored.
--
-- Games together come from player_games (each player's own recent matches, kept 60 days by the
-- refresh-trends job), so both functions look back 60 days. A game counts as together when both
-- players have a row for the match with the same result, so the rare game on opposite teams never
-- counts. Both players were in those games, so they show whatever the friend's hero sharing
-- setting is. A friend's own activity (their last game without you) shows only when they share
-- with friends.

-- One row per accepted friend of the caller.
--   party_state: 'yours' when they are in the caller's open party, 'other' for another open party,
--     null when they are in none. party_size counts that party's members.
--   games_together, wins_together, last_together: shared games in the window.
--   games_without, wins_without: the caller's other games in the window, for "Won 52% without".
--   last_game_at: the friend's latest game in the window; null unless they share with friends.
create function public.friend_overview()
returns table (
  user_id uuid,
  party_state text,
  party_size smallint,
  games_together integer,
  wins_together integer,
  last_together timestamptz,
  games_without integer,
  wins_without integer,
  last_game_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select (select auth.uid()) as id),
  friends as (
    select case when f.requester_id = (select id from me) then f.addressee_id else f.requester_id end as id
    from public.friendships f
    where f.status = 'accepted' and (select id from me) in (f.requester_id, f.addressee_id)
  ),
  mine as (
    select g.match_id, g.is_win from public.player_games g
    where g.user_id = (select id from me) and g.started_at > now() - interval '60 days'
  ),
  totals as (
    select count(*)::integer as games, count(*) filter (where is_win)::integer as wins from mine
  ),
  together as (
    select g.user_id, count(*)::integer as games, count(*) filter (where g.is_win)::integer as wins,
      max(g.started_at) as last_at
    from public.player_games g
    join mine m on m.match_id = g.match_id and m.is_win = g.is_win
    where g.user_id in (select id from friends)
    group by g.user_id
  ),
  open_party as (
    select pm.user_id, pm.party_id,
      (select count(*) from public.party_members x where x.party_id = pm.party_id)::smallint as size
    from public.party_members pm
    join public.parties p on p.id = pm.party_id and p.closed_at is null
    where pm.user_id in (select id from friends)
  )
  select fr.id,
    case when op.party_id is null then null
      when op.party_id = public.my_party() then 'yours'
      else 'other' end,
    op.size,
    coalesce(t.games, 0),
    coalesce(t.wins, 0),
    t.last_at,
    (select games from totals) - coalesce(t.games, 0),
    (select wins from totals) - coalesce(t.wins, 0),
    case when pr.share_heroes_with_friends then
      (select max(g.started_at) from public.player_games g
        where g.user_id = fr.id and g.started_at > now() - interval '60 days')
    end
  from friends fr
  join public.profiles pr on pr.id = fr.id
  left join together t on t.user_id = fr.id
  left join open_party op on op.user_id = fr.id
  where (select id from me) is not null
  order by fr.id
$$;

-- The games the caller played together with one accepted friend in the window, newest first.
-- Anyone else gets no rows.
create function public.games_with_friend(friend uuid)
returns table (
  match_id bigint,
  started_at timestamptz,
  game_mode smallint,
  lobby_type smallint,
  is_win boolean,
  my_hero_id smallint,
  my_position smallint,
  friend_hero_id smallint,
  friend_position smallint
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.match_id, m.started_at, m.game_mode, m.lobby_type, m.is_win,
    m.hero_id, m.position, g.hero_id, g.position
  from public.player_games m
  join public.player_games g on g.match_id = m.match_id and g.user_id = friend and g.is_win = m.is_win
  where m.user_id = (select auth.uid())
    and m.started_at > now() - interval '60 days'
    and exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and ((f.requester_id = m.user_id and f.addressee_id = friend)
          or (f.addressee_id = m.user_id and f.requester_id = friend))
    )
  order by m.started_at desc, m.match_id desc
$$;

revoke execute on function public.friend_overview, public.games_with_friend from public, anon;
grant execute on function public.friend_overview, public.games_with_friend to authenticated;
