-- Attaches a found match to a party draft in one step: the result, who played which
-- hero, and an empty report row for the build-reports job. Used by the draft-result
-- function (and later the job), with the service role only.
--
-- Only the first attach wins (match_id is set only while it is null), so the
-- after-game card and the job finding the same game at once can't both write.

create function public.attach_draft_match(
  draft uuid,
  match bigint,
  did_win boolean,
  -- Our side's players in the match: [{"account_id": 123 or null, "hero_id": 1}, ...].
  our_players jsonb,
  mode smallint,
  lobby smallint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  opened_at timestamptz;
begin
  if jsonb_typeof(our_players) is distinct from 'array' then
    raise exception 'our_players must be an array' using errcode = '22023';
  end if;

  update public.party_drafts set match_id = match, won = did_win
  where id = draft and match_id is null
  returning created_at into opened_at;
  if not found then
    return false;
  end if;

  -- A draft nobody ended has no players saved yet: take the members who were in the
  -- party when it opened, plus any member whose Steam account played this match (the
  -- fifth player often joins during the draft). Then close it, so it isn't reused.
  if not exists (select 1 from public.draft_players where draft_id = draft) then
    perform public.record_draft_players(draft, opened_at);
    insert into public.draft_players (draft_id, user_id, account_id, position)
    select draft, m.user_id, pr.steam_id::bigint - 76561197960265728, m.position
    from public.party_drafts d
    join public.party_members m on m.party_id = d.party_id
    join public.profiles pr on pr.id = m.user_id
    where d.id = draft and pr.steam_id is not null
      and (pr.steam_id::bigint - 76561197960265728) in (
        select (p ->> 'account_id')::bigint from jsonb_array_elements(our_players) p
        where jsonb_typeof(p -> 'account_id') = 'number'
      )
    on conflict (draft_id, user_id) do nothing;
    update public.party_drafts set ended_at = now() where id = draft and ended_at is null;
  end if;

  -- Each player's hero from their account in the match.
  update public.draft_players dp set hero_id = (p ->> 'hero_id')::smallint, hero_source = 'account'
  from jsonb_array_elements(our_players) p
  where dp.draft_id = draft and jsonb_typeof(p -> 'account_id') = 'number'
    and dp.account_id = (p ->> 'account_id')::bigint;

  -- Hidden accounts: the ally pick entered for the position the player was shown
  -- suggestions for, if no one else has that hero yet.
  update public.draft_players dp set hero_id = a.hero_id, hero_source = 'position'
  from public.draft_suggestions s
  join lateral (
    select x.hero_id from (
      select distinct on (da.hero_id) da.hero_id, da.kind, da.position
      from public.draft_actions da where da.draft_id = draft
      order by da.hero_id, da.id desc
    ) x
    where x.kind = 'ally' and x.position = s.position
  ) a on true
  where dp.draft_id = draft and dp.hero_id is null
    and s.draft_id = draft and s.user_id = dp.user_id
    and not exists (select 1 from public.draft_players o where o.draft_id = draft and o.hero_id = a.hero_id);

  insert into public.match_reports (draft_id, match_id, game_mode, lobby_type)
  values (draft, match, mode, lobby)
  on conflict (draft_id) do nothing;
  return true;
end;
$$;

revoke execute on function public.attach_draft_match from public, anon, authenticated;
grant execute on function public.attach_draft_match to service_role;
