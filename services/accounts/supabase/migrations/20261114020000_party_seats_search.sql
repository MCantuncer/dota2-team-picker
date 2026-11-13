-- Party inside Draft, second step.
--
-- 1. The after-game match search also looks at seated players' Steam accounts (players the
--    leader seated who never joined on the site). They go in draft_search_accounts, not in
--    draft_players, so they get no Game Report access and don't show up as having played.
-- 2. copy_board_to_party_draft: the picks, bans and positions typed before the party move
--    into its new draft in one step, all or nothing.

create table public.draft_search_accounts (
  draft_id uuid not null references public.party_drafts (id) on delete cascade,
  -- A Dota account (Steam ID minus 76561197960265728).
  account_id bigint not null check (account_id > 0),
  primary key (draft_id, account_id)
);

-- Read and written only by the functions below and the service role.
alter table public.draft_search_accounts enable row level security;
revoke all on public.draft_search_accounts from anon, authenticated;

-- Saves the party's members as the draft's players, as before, and its seated players'
-- accounts for the match search.
create or replace function public.record_draft_players(draft uuid, joined_by timestamptz default null)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.draft_players (draft_id, user_id, account_id, position)
  select d.id, m.user_id, pr.steam_id::bigint - 76561197960265728,
    coalesce(s.position, m.position)
  from public.party_drafts d
  join public.party_members m on m.party_id = d.party_id
  join public.profiles pr on pr.id = m.user_id
  left join public.draft_suggestions s on s.draft_id = d.id and s.user_id = m.user_id
  where d.id = draft and (joined_by is null or m.joined_at <= joined_by)
  on conflict (draft_id, user_id) do nothing;

  insert into public.draft_search_accounts (draft_id, account_id)
  select d.id, pr.steam_id::bigint - 76561197960265728
  from public.party_drafts d
  join public.party_seats s on s.party_id = d.party_id
  join public.profiles pr on pr.id = s.user_id
  where d.id = draft and pr.steam_id is not null
  on conflict do nothing;
$$;

revoke execute on function public.record_draft_players from public, anon, authenticated;

-- The job's draft list, as before, with seated players' accounts searched too.
create or replace function public.claim_unattached_drafts(max_rows integer default 5)
returns table (draft_id uuid, created_at timestamptz, allies smallint[], account_ids bigint[])
language plpgsql
security definer
set search_path = ''
as $$
begin
  if max_rows not between 1 and 20 then
    raise exception 'max_rows must be 1 to 20' using errcode = '22023';
  end if;
  return query
  with candidates as (
    select d.id, d.ended_at, (select max(a.created_at) from public.draft_actions a where a.draft_id = d.id) as last_action
    from public.party_drafts d
    where d.match_id is null and (d.ended_at is null or d.ended_at > now() - interval '6 hours')
  ), states as (
    select s.draft_id, s.hero_id, s.kind from (
      select distinct on (a.draft_id, a.hero_id) a.draft_id, a.hero_id, a.kind
      from public.draft_actions a
      join candidates c on c.id = a.draft_id
      order by a.draft_id, a.hero_id, a.id desc
    ) s
  ), picks as (
    select s.draft_id,
      array_agg(s.hero_id order by s.hero_id) filter (where s.kind = 'ally') as allies,
      count(*) filter (where s.kind = 'ally') as ally_count,
      count(*) filter (where s.kind = 'enemy') as enemy_count
    from states s
    group by s.draft_id
  ), ready as (
    select c.id from candidates c
    join picks on picks.draft_id = c.id
    where picks.allies is not null
      and (
        c.ended_at is not null
        or (picks.ally_count = 5 and picks.enemy_count = 5
          and c.last_action <= now() - interval '20 minutes' and c.last_action > now() - interval '6 hours')
      )
  ), searched as (
    select p.draft_id, p.account_id
    from public.draft_players p
    join ready r on r.id = p.draft_id
    where p.account_id is not null
    union
    select a.draft_id, a.account_id
    from public.draft_search_accounts a
    join ready r on r.id = a.draft_id
    union
    -- An open draft has no players saved yet: its party's members and seated players with Steam linked.
    select d.id, pr.steam_id::bigint - 76561197960265728
    from public.party_drafts d
    join ready r on r.id = d.id
    join (
      select m.party_id, m.user_id from public.party_members m
      union all
      select s.party_id, s.user_id from public.party_seats s
    ) w on w.party_id = d.party_id
    join public.profiles pr on pr.id = w.user_id
    where d.ended_at is null and pr.steam_id is not null
      and not exists (select 1 from public.draft_players x where x.draft_id = d.id)
  ), accounts as (
    select s.draft_id, array_agg(s.account_id order by s.account_id) as account_ids
    from searched s
    group by s.draft_id
  ), due as (
    select d.id from public.party_drafts d
    join ready on ready.id = d.id
    join accounts on accounts.draft_id = d.id
    where d.match_id is null and public.find_is_due(d.result_checked_at, d.find_tries, interval '10 minutes', 6)
    order by coalesce(d.ended_at, d.created_at)
    limit max_rows
    for update of d skip locked
  ), claimed as (
    update public.party_drafts d set find_tries = d.find_tries + 1, result_checked_at = now()
    from due where d.id = due.id
    returning d.id, d.created_at
  )
  select c.id, c.created_at, picks.allies, accounts.account_ids
  from claimed c
  join picks on picks.draft_id = c.id
  join accounts on accounts.draft_id = c.id;
end;
$$;

revoke execute on function public.claim_unattached_drafts from public, anon, authenticated;
grant execute on function public.claim_unattached_drafts to service_role;

-- Copies the board typed before the party into its new, empty draft:
-- [{"kind": "ally" | "enemy" | "ban", "hero_id": 1, "position": 2 or null}, ...].
-- Each entry goes through add_draft_action, so the same checks apply (party member,
-- planner only, hero not twice, 5 picks a side, 24 bans). One bad entry copies nothing.
create function public.copy_board_to_party_draft(draft uuid, actions jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry jsonb;
begin
  if jsonb_typeof(actions) is distinct from 'array' then
    raise exception 'actions must be a list' using errcode = '22023';
  elsif jsonb_array_length(actions) > 34 then
    raise exception 'A board has at most 34 entries' using errcode = '22023';
  end if;
  if not public.in_draft_party(draft) then
    raise exception 'Draft not found' using errcode = 'P0002';
  end if;
  if not public.may_change_draft(draft) then
    raise exception 'Only the draft captain can change the draft' using errcode = '42501';
  end if;
  perform 1 from public.party_drafts where id = draft and ended_at is null for update;
  if not found then
    raise exception 'This draft has ended' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.draft_actions where draft_id = draft) then
    raise exception 'This draft already has heroes' using errcode = '23505';
  end if;

  for entry in select value from jsonb_array_elements(actions) loop
    if jsonb_typeof(entry) is distinct from 'object'
      or entry ->> 'kind' not in ('ally', 'enemy', 'ban')
      or jsonb_typeof(entry -> 'hero_id') is distinct from 'number'
      or coalesce(jsonb_typeof(entry -> 'position'), 'null') not in ('number', 'null') then
      raise exception 'Each entry needs a kind, a hero_id and an optional position' using errcode = '22023';
    end if;
    perform public.add_draft_action(
      draft, entry ->> 'kind', (entry ->> 'hero_id')::smallint, (entry ->> 'position')::smallint
    );
  end loop;
end;
$$;

revoke execute on function public.copy_board_to_party_draft from public, anon;
grant execute on function public.copy_board_to_party_draft to authenticated;
