-- What the build-reports job reads, as service role only functions.
--
-- claim_match_reports hands each run up to max_rows reports that are due, and leases them
-- for a few minutes, so two runs that overlap never build the same report. A run that
-- dies leaves its lease to run out; the next run then takes the report again.
--
-- report_draft_lists gives each of the draft's picks with the list its player was shown,
-- for the report's draft review and the suggestion records.

create function public.claim_match_reports(max_rows integer default 10, lease interval default '5 minutes')
returns table (
  draft_id uuid,
  match_id bigint,
  won boolean,
  parse_requests smallint,
  parse_requested_at timestamptz,
  attempts smallint,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if max_rows not between 1 and 50 or lease not between interval '1 minute' and interval '30 minutes' then
    raise exception 'max_rows must be 1 to 50 and lease 1 to 30 minutes' using errcode = '22023';
  end if;
  return query
  with due as (
    select r.draft_id from public.match_reports r
    where r.status = 'waiting_parse' and r.next_try_at <= now()
      and (r.lease_until is null or r.lease_until < now())
    order by r.next_try_at
    limit max_rows
    for update skip locked
  ), claimed as (
    update public.match_reports r set lease_until = now() + lease
    from due where r.draft_id = due.draft_id
    returning r.draft_id, r.match_id, r.parse_requests, r.parse_requested_at, r.attempts, r.created_at
  )
  select c.draft_id, c.match_id, d.won, c.parse_requests, c.parse_requested_at, c.attempts, c.created_at
  from claimed c join public.party_drafts d on d.id = c.draft_id;
end;
$$;

-- A pick counts as made from a list only when the list was last saved no later than the
-- hero was first entered for our team; otherwise (no list, or one saved after the pick)
-- the list is empty, which the report shows as "no list".
create function public.report_draft_lists(draft uuid)
returns table (hero_id smallint, shown smallint[])
language sql
stable
security definer
set search_path = ''
as $$
  select p.hero_id,
    case when s.updated_at <= (
      select min(a.created_at) from public.draft_actions a
      where a.draft_id = p.draft_id and a.kind = 'ally' and a.hero_id = p.hero_id
    ) then s.heroes else '{}'::smallint[] end
  from public.draft_players p
  left join public.draft_suggestions s on s.draft_id = p.draft_id and s.user_id = p.user_id
  where p.draft_id = draft and p.hero_id is not null
  order by p.hero_id;
$$;

revoke execute on function public.claim_match_reports, public.report_draft_lists from public, anon, authenticated;
grant execute on function public.claim_match_reports, public.report_draft_lists to service_role;
