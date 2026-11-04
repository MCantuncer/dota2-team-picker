-- A Stack's owner is never also one of its members. Accepting an invite to your own Stack used to add a
-- member row for the owner, so they were listed twice and every player count was one too high.

delete from public.team_members m
using public.teams t
where t.id = m.team_id and m.user_id = t.owner_id;

-- Joining your own Stack (an invite, a request) is a no-op, like joining one you are already in.
create function public.skip_owner_membership()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.teams t where t.id = new.team_id and t.owner_id = new.user_id) then
    return null;
  end if;
  return new;
end;
$$;

create trigger team_members_skip_owner
before insert or update of team_id, user_id on public.team_members
for each row execute function public.skip_owner_membership();

revoke execute on function public.skip_owner_membership from public, anon, authenticated;
