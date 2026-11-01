-- The build-reports job: every 10 minutes pg_cron calls the build-reports edge function,
-- which finds the matches of drafts nobody looked up and builds their reports.
--
-- The function's URL and a shared secret live in Vault (build_reports_url,
-- build_reports_secret). Until both are there the schedule does nothing. The function
-- checks the secret; the service role key never leaves the database.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- How many times the job looked for this draft's match.
alter table public.party_drafts add column find_tries smallint not null default 0 check (find_tries >= 0);

-- Ended drafts of the last 6 hours with no match yet, tried at most 6 times at growing
-- gaps (10, 20, 40 minutes ...). Each comes with our heroes and the players' accounts to
-- search; drafts with neither are left alone.
create function public.claim_unattached_drafts(max_rows integer default 5)
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
  with picks as (
    select s.draft_id, array_agg(s.hero_id order by s.hero_id) as allies from (
      select distinct on (a.draft_id, a.hero_id) a.draft_id, a.hero_id, a.kind
      from public.draft_actions a
      join public.party_drafts d on d.id = a.draft_id
      where d.match_id is null and d.ended_at > now() - interval '6 hours'
      order by a.draft_id, a.hero_id, a.id desc
    ) s
    where s.kind = 'ally'
    group by s.draft_id
  ), accounts as (
    select p.draft_id, array_agg(p.account_id order by p.account_id) as account_ids
    from public.draft_players p
    where p.account_id is not null
    group by p.draft_id
  ), due as (
    select d.id from public.party_drafts d
    join picks on picks.draft_id = d.id
    join accounts on accounts.draft_id = d.id
    where d.match_id is null and d.ended_at > now() - interval '6 hours' and d.find_tries < 6
      and (d.result_checked_at is null
        or d.result_checked_at <= now() - interval '10 minutes' * power(2, greatest(d.find_tries - 1, 0)))
    order by d.ended_at
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

-- Called by pg_cron. Reads the URL and secret from Vault; does nothing until both are set.
create function public.run_build_reports()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  fn_url text := (select decrypted_secret from vault.decrypted_secrets where name = 'build_reports_url');
  job_secret text := (select decrypted_secret from vault.decrypted_secrets where name = 'build_reports_secret');
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

revoke execute on function public.run_build_reports from public, anon, authenticated, service_role;

select cron.schedule('build-reports', '*/10 * * * *', 'select public.run_build_reports()');
