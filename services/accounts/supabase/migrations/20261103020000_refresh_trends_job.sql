-- The refresh-trends job: every 30 minutes pg_cron calls the refresh-trends edge function,
-- which reads active Steam players' recent games and opens hero pool cards (rules in
-- functions/_shared/trends). The URL and shared secret live in Vault (refresh_trends_url,
-- refresh_trends_secret); until both are set the schedule does nothing.

-- Hands out up to max_rows players whose check is due: Steam linked, cards not stopped,
-- active in the last 14 days, last checked over 12 hours ago. Marks them checked at once so
-- two runs never take the same player. Each comes with what the rules need: the hero
-- record, the pool, the hero and position pairs not to suggest, and whether a card opened
-- in the last day (at most one new card a day).
create function public.claim_trend_players(max_rows integer default 10)
returns table (
  user_id uuid,
  account_id bigint,
  hero_stats jsonb,
  pool jsonb,
  skip text[],
  has_recent_card boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if max_rows not between 1 and 50 then
    raise exception 'max_rows must be 1 to 50' using errcode = '22023';
  end if;
  return query
  with due as (
    select p.id from public.profiles p
    where p.steam_id is not null and not p.pool_suggestions_off
      and p.last_active_at > now() - interval '14 days'
      and (p.trends_checked_at is null or p.trends_checked_at < now() - interval '12 hours')
    order by p.trends_checked_at nulls first
    limit max_rows
    for update skip locked
  ), claimed as (
    update public.profiles p set trends_checked_at = now()
    from due where p.id = due.id
    returning p.id, p.steam_id, p.hero_stats
  )
  select
    c.id,
    -- SteamID64 minus the base of account 0.
    (c.steam_id::numeric - 76561197960265728)::bigint,
    c.hero_stats,
    coalesce(
      (select jsonb_agg(jsonb_build_object('heroId', f.hero_id, 'position', f.position))
       from public.favorite_heroes f where f.user_id = c.id),
      '[]'::jsonb
    ),
    array(
      select distinct s.hero_id || ':' || s.position from public.pool_suggestions s
      where s.user_id = c.id and (
        s.status in ('open', 'snoozed', 'blocked')
        -- Unanswered cards that ran out wait 30 days.
        or (s.status = 'expired' and s.updated_at > now() - interval '30 days')
        -- A No waits 30 days and 3 more strong wins on that hero and position.
        or (s.status = 'declined' and (
          s.declined_at > now() - interval '30 days'
          or (select count(*) from public.player_games g
              where g.user_id = c.id and g.hero_id = s.hero_id and g.position = s.position
                and g.is_win and g.is_strong and g.started_at > s.declined_at) < 3
        ))
      )
    ),
    exists (select 1 from public.pool_suggestions s where s.user_id = c.id and s.created_at > now() - interval '1 day')
  from claimed c;
end;
$$;

-- Saves one player's check in one go: the state, their counted games (kept 60 days), at
-- most one new card, and closes open cards that ran 14 days or no longer qualify. A hidden
-- profile keeps its games and cards as they are.
create function public.save_trend_check(
  target uuid,
  state text,
  games jsonb,
  new_card jsonb,
  qualifying text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if state not in ('ok', 'hidden') then
    raise exception 'state must be ok or hidden' using errcode = '22023';
  end if;
  update public.profiles set trends_state = state where id = target;
  if state = 'hidden' then
    return;
  end if;

  insert into public.player_games (user_id, match_id, hero_id, position, position_source, is_win, is_strong, imp,
    percentiles, stat_values, lobby_rank, started_at, game_mode, lobby_type)
  select target, g.match_id, g.hero_id, g.position, g.position_source, g.is_win, g.is_strong, g.imp,
    g.percentiles, g.stat_values, g.lobby_rank, g.started_at, g.game_mode, g.lobby_type
  from jsonb_to_recordset(coalesce(games, '[]'::jsonb)) as g (
    match_id bigint, hero_id smallint, position smallint, position_source text, is_win boolean, is_strong boolean,
    imp smallint, percentiles jsonb, stat_values jsonb, lobby_rank smallint, started_at timestamptz,
    game_mode smallint, lobby_type smallint
  )
  on conflict (user_id, match_id) do update set
    position = excluded.position, position_source = excluded.position_source, is_strong = excluded.is_strong,
    imp = excluded.imp, percentiles = excluded.percentiles, stat_values = excluded.stat_values;

  delete from public.player_games where user_id = target and started_at < now() - interval '60 days';

  update public.pool_suggestions set status = 'expired'
  where user_id = target and status = 'open'
    and (created_at < now() - interval '14 days' or not (hero_id || ':' || position = any (coalesce(qualifying, '{}'))));

  if new_card is not null then
    insert into public.pool_suggestions (user_id, hero_id, position, question, reason, evidence)
    values (target, (new_card ->> 'heroId')::smallint, (new_card ->> 'position')::smallint,
      new_card ->> 'question', new_card ->> 'reason', new_card -> 'evidence')
    on conflict (user_id, hero_id, position) where status in ('open', 'snoozed') do nothing;
  end if;
end;
$$;

revoke execute on function public.claim_trend_players, public.save_trend_check from public, anon, authenticated;
grant execute on function public.claim_trend_players, public.save_trend_check to service_role;

-- Called by pg_cron. Reads the URL and secret from Vault; does nothing until both are set.
create function public.run_refresh_trends()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  fn_url text := (select decrypted_secret from vault.decrypted_secrets where name = 'refresh_trends_url');
  job_secret text := (select decrypted_secret from vault.decrypted_secrets where name = 'refresh_trends_secret');
begin
  if fn_url is null or job_secret is null then
    return;
  end if;
  perform net.http_post(
    url := fn_url,
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Job-Secret', job_secret),
    timeout_milliseconds := 60000
  );
end;
$$;

revoke execute on function public.run_refresh_trends from public, anon, authenticated, service_role;

select cron.schedule('refresh-trends', '*/30 * * * *', 'select public.run_refresh_trends()');
