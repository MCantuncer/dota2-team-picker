-- Account types. Every account starts as 'user'; 'captain' can run Captain
-- mode (create teams, send invites) and 'admin' can do that plus open the
-- admin pages. Only set by hand in the database, for example in the SQL editor:
--
--   update public.profiles set user_type = 'admin' where id = '<user id>';
--
-- Users can't change it themselves: they may only update display_name and
-- avatar_url (see the profiles migration).

alter table public.profiles
  add column user_type text not null default 'user' check (user_type in ('user', 'captain', 'admin'));

comment on column public.profiles.user_type is 'user, captain or admin. Set by hand; users cannot change it.';

-- True when the signed-in user may run Captain mode.
create function public.is_captain()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.user_type in ('captain', 'admin')
  )
$$;

revoke execute on function public.is_captain from public, anon;
grant execute on function public.is_captain to authenticated;

-- Only captains can create teams. Existing teams stay with their owners.
drop policy "Create own teams" on public.teams;

create policy "Captains create own teams" on public.teams
for insert to authenticated with check ((select auth.uid()) = owner_id and public.is_captain());
