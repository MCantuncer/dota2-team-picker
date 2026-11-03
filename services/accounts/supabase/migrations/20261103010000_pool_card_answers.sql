-- Answering hero pool cards, the stop switch, and the activity mark the trends job reads.
-- Each is one security definer function so a player can change only their own rows, and
-- only in the ways listed here (the tables stay read only for players).

-- Answers: 'yes' adds the hero to that position (and turns the position on), 'no' declines
-- (a second No for the same hero and position blocks it for good), 'later' snoozes 3 days.
-- Only an open or snoozed card changes; answering an answered card returns its status as is.
create function public.answer_pool_suggestion(card uuid, answer text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  suggestion public.pool_suggestions%rowtype;
  earlier_noes integer;
begin
  if answer is null or answer not in ('yes', 'no', 'later') then
    raise exception 'Answer must be yes, no or later' using errcode = '22023';
  end if;
  select * into suggestion from public.pool_suggestions s where s.id = card and s.user_id = me for update;
  if not found then
    raise exception 'Card not found' using errcode = 'P0002';
  end if;
  if suggestion.status not in ('open', 'snoozed') then
    return suggestion.status;
  end if;

  if answer = 'yes' then
    insert into public.favorite_positions (user_id, position) values (me, suggestion.position) on conflict do nothing;
    insert into public.favorite_heroes (user_id, position, hero_id) values (me, suggestion.position, suggestion.hero_id)
    on conflict do nothing;
    update public.pool_suggestions
    set status = 'accepted', snooze_until = null, answered_at = now()
    where id = card;
    return 'accepted';
  elsif answer = 'no' then
    select count(*) into earlier_noes from public.pool_suggestions s
    where s.user_id = me and s.hero_id = suggestion.hero_id and s.position = suggestion.position and s.status = 'declined';
    update public.pool_suggestions
    set status = case when earlier_noes >= 1 then 'blocked' else 'declined' end,
      decline_count = earlier_noes + 1, declined_at = now(), snooze_until = null, answered_at = now()
    where id = card;
    return case when earlier_noes >= 1 then 'blocked' else 'declined' end;
  else
    update public.pool_suggestions
    set status = 'snoozed', snooze_until = now() + interval '3 days'
    where id = card;
    return 'snoozed';
  end if;
end;
$$;

-- The "Stop these suggestions" switch. Turning it on also closes the cards still waiting.
create function public.set_pool_suggestions_off(is_off boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null or is_off is null then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  update public.profiles set pool_suggestions_off = is_off where id = me;
  if is_off then
    update public.pool_suggestions set status = 'expired', snooze_until = null
    where user_id = me and status in ('open', 'snoozed');
  end if;
end;
$$;

-- Marks the player as active, at most once every 10 minutes, so the site can call it on
-- every page load without a write each time.
create function public.mark_active()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles set last_active_at = now()
  where id = (select auth.uid())
    and (last_active_at is null or last_active_at < now() - interval '10 minutes')
$$;

revoke execute on function public.answer_pool_suggestion, public.set_pool_suggestions_off, public.mark_active
from public, anon;
grant execute on function public.answer_pool_suggestion, public.set_pool_suggestions_off, public.mark_active
to authenticated;
