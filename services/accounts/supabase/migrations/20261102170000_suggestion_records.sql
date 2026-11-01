-- Records from the signed-in player's own reported games (Plan 5 Part B):
--
-- my_suggestion_record: games and wins by where my hero was in the list I was shown:
-- 'top3', 'in8' (4th to 8th), 'not_shown', or 'no_list' (no list, a list saved after
-- my pick, or no hero known). The website hides rates under 10 games.
--
-- my_pair_records: for each teammate I played with, games and wins together, in total
-- (positions null) and by our two positions when both are known.
--
-- Both count only games with a report, a known result and a normal draft mode: All Pick
-- (1), Captains Mode (2) or Ranked All Pick (22). Turbo and other modes are left out.

-- My reported games in those modes: the draft, my hero and position, the result.
create function public.my_record_games()
returns table (draft_id uuid, hero_id smallint, "position" smallint, won boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p.draft_id, p.hero_id, p.position, d.won
  from public.draft_players p
  join public.party_drafts d on d.id = p.draft_id
  join public.match_reports r on r.draft_id = p.draft_id
  where p.user_id = (select auth.uid()) and d.won is not null and r.game_mode in (1, 2, 22)
$$;

create function public.my_suggestion_record()
returns table (bucket text, games integer, wins integer)
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select g.won,
      case
        when coalesce(cardinality(l.shown), 0) = 0 then 'no_list'
        when array_position(l.shown, g.hero_id) <= 3 then 'top3'
        when array_position(l.shown, g.hero_id) is not null then 'in8'
        else 'not_shown'
      end as bucket
    from public.my_record_games() g
    left join lateral (
      select x.shown from public.report_draft_lists(g.draft_id) x where x.hero_id = g.hero_id
    ) l on true
  )
  select b.bucket, count(m.bucket)::integer, (count(m.bucket) filter (where m.won))::integer
  from (values ('top3', 1), ('in8', 2), ('not_shown', 3), ('no_list', 4)) b (bucket, sort)
  left join mine m on m.bucket = b.bucket
  group by b.bucket, b.sort
  order by b.sort
$$;

create function public.my_pair_records()
returns table (
  teammate_id uuid,
  teammate_name text,
  my_position smallint,
  their_position smallint,
  games integer,
  wins integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with pairs as (
    select o.user_id as teammate, g.position as mine, o.position as theirs, g.won
    from public.my_record_games() g
    join public.draft_players o on o.draft_id = g.draft_id and o.user_id <> (select auth.uid())
  )
  select p.teammate, max(pr.display_name), p.mine, p.theirs, count(*)::integer,
    (count(*) filter (where p.won))::integer
  from pairs p
  left join public.profiles pr on pr.id = p.teammate
  group by grouping sets ((p.teammate), (p.teammate, p.mine, p.theirs))
  having grouping(p.mine) = 1 or (p.mine is not null and p.theirs is not null)
  order by p.teammate, grouping(p.mine) desc, p.mine, p.theirs
$$;

-- my_record_games is a building block; the website calls the two records.
revoke execute on function public.my_record_games, public.my_suggestion_record, public.my_pair_records
  from public, anon;
revoke execute on function public.my_record_games from authenticated;
grant execute on function public.my_suggestion_record, public.my_pair_records to authenticated;
