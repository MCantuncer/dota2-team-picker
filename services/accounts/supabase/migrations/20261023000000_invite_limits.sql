-- Invites expire 7 days after they were last sent, and sending is rate limited.
--
-- sent_at is set on every send (the team-invite function counts recent sends
-- per captain from it). An invite older than 7 days can't be accepted; the
-- captain re-sends it to get a fresh link.

alter table public.team_invites add column sent_at timestamptz not null default now();

create index team_invites_sent_at_idx on public.team_invites (sent_at);

drop function public.get_team_invite(uuid);

create function public.get_team_invite(invite uuid)
returns table (team_name text, captain_name text, email text, accepted boolean, expired boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select t.name, p.display_name, i.email, i.accepted_at is not null, i.sent_at < now() - interval '7 days'
  from public.team_invites i
  join public.teams t on t.id = i.team_id
  join public.profiles p on p.id = t.owner_id
  where i.id = invite
$$;

grant execute on function public.get_team_invite to anon, authenticated;

create or replace function public.accept_team_invite(invite uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  found public.team_invites;
begin
  select * into found from public.team_invites where id = invite;
  if found.id is null then
    raise exception 'Invite not found' using errcode = 'P0002';
  end if;
  if found.email <> lower(coalesce((select auth.jwt() ->> 'email'), '')) then
    raise exception 'This invite is for %', found.email using errcode = '42501';
  end if;
  if found.accepted_at is null and found.sent_at < now() - interval '7 days' then
    raise exception 'This invite has expired. Ask your captain to send it again.' using errcode = '42501';
  end if;
  insert into public.team_members (team_id, user_id) values (found.team_id, (select auth.uid()))
  on conflict do nothing;
  update public.team_invites set accepted_at = coalesce(accepted_at, now()) where id = invite;
  return found.team_id;
end;
$$;
