-- Captain mode is gone: every user can make Stacks and plan a party's draft,
-- so the 'captain' account type no longer means anything. Captains become
-- plain users, the type only allows 'user' and 'admin', and is_captain() goes
-- (nothing calls it since Stacks opened to everyone).

update public.profiles set user_type = 'user' where user_type = 'captain';

alter table public.profiles drop constraint profiles_user_type_check;
alter table public.profiles add constraint profiles_user_type_check check (user_type in ('user', 'admin'));

comment on column public.profiles.user_type is 'user or admin. Set by hand; users cannot change it.';

drop function public.is_captain();
