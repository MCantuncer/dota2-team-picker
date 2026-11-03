-- Stacks (the teams table) for everyone: any signed-in user may create one, up to 10 each.
-- Before this, only captain and admin accounts could create teams.
--
-- Also:
--   * invite_sends: an append-only log of every invite email, so email limits count real sends
--     (team_invites keeps one row per team and address, so a resend overwrote the old one).
--   * claim_invite_send(): checks every email limit and logs the send in one locked step.
--   * can_invite(): a shared Stack lets only its owner and co-captains party-invite its members.
--     Members no longer reach the owner or each other through the Stack (friends still can).

-- Anyone creates their own Stacks.
drop policy "Captains create own teams" on public.teams;

create policy "Create own teams" on public.teams
for insert to authenticated with check ((select auth.uid()) = owner_id);

-- At most 10 owned Stacks per user. Locks the owner's profile row so two inserts at once
-- cannot both pass the count.
create function public.limit_owned_teams()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.profiles p where p.id = new.owner_id for update;
  if (select count(*) from public.teams t where t.owner_id = new.owner_id) >= 10 then
    raise exception 'You can own 10 stacks at most' using errcode = '54000';
  end if;
  return new;
end;
$$;

revoke execute on function public.limit_owned_teams from public, anon, authenticated;

create trigger limit_owned_teams
before insert on public.teams
for each row execute function public.limit_owned_teams();

-- Every invite email sent, kept so limits cannot be reset by resending. Only the service role
-- (the team-invite function) reads or writes it.
create table public.invite_sends (
  id bigint generated always as identity primary key,
  sender_id uuid not null references auth.users (id) on delete cascade,
  team_id uuid references public.teams (id) on delete set null,
  email text not null,
  sent_at timestamptz not null default now()
);

create index invite_sends_sender on public.invite_sends (sender_id, sent_at);
create index invite_sends_email on public.invite_sends (email, sent_at);
create index invite_sends_sent_at on public.invite_sends (sent_at);

alter table public.invite_sends enable row level security;
revoke all on public.invite_sends from anon, authenticated;

comment on table public.invite_sends is 'Append-only log of invite emails, for the send limits. Service role only.';

-- Checks the email limits and, when they allow it, logs the send. Returns 'ok' or the limit hit:
--   resend_wait    the same Stack and address got an email in the last minute
--   sender_daily   30 emails in a day from this sender
--   new_account    5 emails in a day from an account younger than a day
--   address_daily  3 emails in a day to this address, from any Stack
--   site_daily     300 emails in a day from the whole site
-- One lock serialises the checks, so parallel requests cannot all pass. Volume is tiny.
create function public.claim_invite_send(sender uuid, team uuid, address text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  day_ago timestamptz := now() - interval '1 day';
  sent_by_sender int;
begin
  perform pg_advisory_xact_lock(hashtext('public.invite_sends'));

  if exists (
    select 1 from public.invite_sends s
    where s.team_id = team and s.email = address and s.sent_at > now() - interval '1 minute'
  ) then
    return 'resend_wait';
  end if;

  select count(*) into sent_by_sender from public.invite_sends s where s.sender_id = sender and s.sent_at > day_ago;
  if sent_by_sender >= 30 then
    return 'sender_daily';
  end if;
  if sent_by_sender >= 5 and exists (select 1 from public.profiles p where p.id = sender and p.created_at > day_ago) then
    return 'new_account';
  end if;
  if (select count(*) from public.invite_sends s where s.email = address and s.sent_at > day_ago) >= 3 then
    return 'address_daily';
  end if;
  if (select count(*) from public.invite_sends s where s.sent_at > day_ago) >= 300 then
    return 'site_daily';
  end if;

  insert into public.invite_sends (sender_id, team_id, email) values (sender, team, address);
  return 'ok';
end;
$$;

revoke execute on function public.claim_invite_send from public, anon, authenticated;
grant execute on function public.claim_invite_send to service_role;

-- Who you may invite to a party: an accepted friend, or a member of a Stack you own or co-captain.
create or replace function public.can_invite(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select (select auth.uid()) as id)
  select exists (
    select 1 from public.friendships f, me
    where f.status = 'accepted'
      and ((f.requester_id = me.id and f.addressee_id = target) or (f.addressee_id = me.id and f.requester_id = target))
  ) or exists (
    select 1 from public.team_members m where m.user_id = target and public.runs_team(m.team_id)
  )
$$;
