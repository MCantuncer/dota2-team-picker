-- Raw matches are kept 90 days (enough to work out facts again), and never longer than a
-- report needs them: a file whose match no longer has any report goes too. The
-- build-reports job deletes the Storage object first, then calls forget_match_files.

create function public.stale_match_files(max_rows integer default 50)
returns table (match_id bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select f.match_id from public.match_files f
  where f.saved_at < now() - interval '90 days'
    or not exists (select 1 from public.match_reports r where r.match_id = f.match_id)
  order by f.saved_at
  limit least(greatest(max_rows, 1), 200);
$$;

-- Drops files from the list once their objects are deleted, if they are still stale (a
-- report saved again in between keeps its file listed; the next run lists it again).
create function public.forget_match_files(matches bigint[])
returns integer
language sql
security definer
set search_path = ''
as $$
  with gone as (
    delete from public.match_files f where f.match_id = any (matches)
      and (f.saved_at < now() - interval '90 days'
        or not exists (select 1 from public.match_reports r where r.match_id = f.match_id))
    returning 1
  )
  select count(*)::integer from gone;
$$;

revoke execute on function public.stale_match_files, public.forget_match_files from public, anon, authenticated;
grant execute on function public.stale_match_files, public.forget_match_files to service_role;
