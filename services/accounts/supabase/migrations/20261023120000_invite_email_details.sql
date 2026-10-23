-- Lets the team-invite function find an existing account by email, so the
-- sign-in email it sends that person can name the captain and the team.
--
-- Only the service role (the edge functions) may call it: anyone else could
-- use it to check which emails have accounts.

create function public.user_id_by_email(address text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from auth.users where email = lower(address) limit 1
$$;

revoke execute on function public.user_id_by_email from public, anon, authenticated;
grant execute on function public.user_id_by_email to service_role;
