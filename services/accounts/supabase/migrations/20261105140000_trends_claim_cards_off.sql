-- Your Games no longer depends on the hero suggestions switch: the trends job now checks every
-- active Steam player, and the switch only stops new cards (cards_off). Before, a player with
-- suggestions off never got their games read, so Your Games stayed empty.
-- The return type changes, so the function is dropped and made again.
drop function public.claim_trend_players(integer);

create function public.claim_trend_players(max_rows integer default 10)
returns table (
  user_id uuid,
  account_id bigint,
  hero_stats jsonb,
  pool jsonb,
  skip text[],
  has_recent_card boolean,
  cards_off boolean
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
    where p.steam_id is not null
      and p.last_active_at > now() - interval '14 days'
      and (p.trends_checked_at is null or p.trends_checked_at < now() - interval '12 hours')
    order by p.trends_checked_at nulls first
    limit max_rows
    for update skip locked
  ), claimed as (
    update public.profiles p set trends_checked_at = now()
    from due where p.id = due.id
    returning p.id, p.steam_id, p.hero_stats, p.pool_suggestions_off
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
    exists (select 1 from public.pool_suggestions s where s.user_id = c.id and s.created_at > now() - interval '1 day'),
    c.pool_suggestions_off
  from claimed c;
end;
$$;

revoke execute on function public.claim_trend_players from public, anon, authenticated;
grant execute on function public.claim_trend_players to service_role;
