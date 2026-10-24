# Engine

Downloads hero data from OpenDota and scores heroes to pick during a draft.
Run the commands below from this folder, or from the repo root with `-w services/engine`.

## Try it

```sh
npm install
npm run suggest -w services/engine -- --pos 2 --allies "Lion:5,Juggernaut:1" --enemies "Pudge,Axe" --rank 6
```

| Option        | Meaning                                                                 |
| ------------- | ----------------------------------------------------------------------- |
| `--pos`       | Your position, 1 (carry) to 5 (hard support). Required.                 |
| `--allies`    | Your team's picks, comma separated. Add `:N` for a known position.      |
| `--enemies`   | The enemy picks.                                                        |
| `--bans`      | Banned heroes.                                                          |
| `--rank`      | 1 Herald ... 8 Immortal. Leave out to use all ranks.                    |
| `--favorites` | Heroes you like playing; they get a small boost.                        |
| `--count`     | How many suggestions (default 8).                                       |
| `--details`   | Also print the score breakdown.                                         |

Hero names ignore case and punctuation, and a unique part of a name works too (`"anti"` for Anti-Mage).

## How a hero is scored

Every part of the score is in win-rate percentage points, so `+2.0` roughly means
"about 2% more likely to win". The parts are added up:

- **Counter**: how the hero does against each enemy already picked, compared with what their
  overall win rates predict. Enemies you will probably meet in lane count up to 1.5x. Enemy
  positions are guessed from which lanes each hero is usually played in.
- **Synergy**: the same idea for the allies already picked.
- **Meta**: the hero's current win rate at your rank.
- **Position fit**: how often the hero is played in your position. Heroes almost never played
  there are left out.
- **Team needs**: covers something your team lacks (stuns, initiation, a save, a frontliner,
  pushing, magic or physical damage). Counts more as your team fills up.
- **Comfort**: your favorites, and your own record on the hero when known.
- **Flex**: early in the draft, a hero that can play several positions hides your plan.
- **Pick safety**: early in the draft, a hero with hard counters still available loses points.

Small samples are pulled toward the expected value, so a 3-0 matchup does not look like a sure win.

With `--rank`, counters and synergy also use games at that rank group (Herald-Guardian,
Crusader-Archon, Legend-Ancient, Divine-Immortal), since a matchup can play out differently at
Herald and at Divine. The rank group's games are pulled toward the all-ranks number rather than
toward zero, so a group with few games (Divine-Immortal is about 5% of public matches) still gets
the all-ranks result, and the rank's own pattern takes over as its games add up.
The weights live at the top of [`src/engine/score.ts`](src/engine/score.ts).

## WCST team plan

WCST (Wombo-Combo Super Team) plans all five heroes for a Captain mode team at once, and
re-plans the open slots every time a hero is picked.

```sh
npm run plan -w services/engine -- --slots "1:=Juggernaut,2:Storm Spirit|Puck,3:Mars|Axe,5:=Dazzle" --enemies "Pudge,Anti-Mage"
```

Each slot is a position, a colon and that player's favorite heroes split by `|`. Put `=` before a
hero that is already picked. Positions left out are planned without a player.

1. Every open slot gets its 10 best candidates on their own: counters against the known enemies,
   meta, position fit and comfort. Heroes from the player's pool get +8, so a hero from outside
   the pool only makes the plan when it is clearly better. Outside the pool, only heroes played
   in that position at least 30% of the time are considered.
2. Every combination of candidates is tried. The team score adds half of each pair's synergy
   (a team has 10 pairs, and adding them in full lets noisy pairs take over) and takes points off
   for each team need the five leave uncovered.
3. On top of the match data, a hand-kept game plan in [`src/engine/gameplan.ts`](src/engine/gameplan.ts)
   adds +1.5 per known spell combo in the five (Magnus + Sven, Mars + Snapfire and so on) and +1 per
   hero beyond two that shares the team's main style (teamfight, push, pick-off or late game).
   A combo partner just outside a slot's top 10 is still tried. The plan ends with one line on how
   to play it, such as "Teamfight: group up and win the big fights with your ultimates. Key combo: ...".
4. Each open slot also gets 2 backups, with how much the team score drops if one is used instead.

In code: `planTeam(engine, { slots, enemies, bans, rankBracket })` from
[`src/engine/plan.ts`](src/engine/plan.ts).

## Data

`npm run fetch-data` downloads data from the free [OpenDota API](https://docs.opendota.com/)
into `data/snapshot.json`:

- hero list, roles and win rates per rank (`/heroStats`)
- which lanes each hero is played in (`/scenarios/laneRoles`)
- recent public matches (`/publicMatches`), counted into hero-vs-hero and same-team records,
  for all ranks and again for the match's rank group (`rankMatchups`, `rankSynergy`)
- the patch list (`/constants/patch`)

and, when the `STRATZ_TOKEN` secret is set, games per position (pos 1-5) for every hero over the
last week from the [STRATZ API](https://stratz.com/api). STRATZ detects each player's real
position, so a roaming pos 4 (Riki, Earth Spirit) no longer looks like a mid the way OpenDota's
lane data makes it look. A hero with fewer than 200 STRATZ games falls back to lane data. If STRATZ
is down, the run keeps the last positions and carries on.

The Action can be started by hand with **dry run** ticked to fetch and build the data without
uploading it, for example to test a change on a branch.

Each run adds new matches to the counts already saved and fades old ones by 1% per day since
the last run, so the data follows the meta as players find new builds. Fading changes how much
old games count, not the win rates they show. Lane roles take one request per hero and change
slowly, so they are downloaded once a week.

### Patches

The snapshot records the patch its counts are for (`patch`). When OpenDota lists a new one
(7.42 after 7.41; letter patches like 7.41f are not listed and are covered by the daily fade):

- old matchup and synergy counts drop to 25%. Most matchups survive a patch, so they are a better
  start than nothing while new games come in, and small samples are already pulled toward
  neutral by the engine.
- only games played since the patch came out are counted.
- the Action opens a GitHub issue to review the hand-kept lists (hard counters, combos and
  styles, hero traits) against the patch notes.

New heroes show up through `/heroStats` on the next run. Until they have games, their matchups
count as neutral.

A GitHub Action ([`refresh-data.yml`](../../.github/workflows/refresh-data.yml)) refreshes the
data four times a day (250 pages, about 15,000 matches each) and can also be started by hand
from the Actions tab. The free API allows about 3,000 requests a day per IP, and GitHub's runners
share IPs, so a run also stops reading pages when fewer than 300 requests are left for the day. The free API allows about
60 requests a minute, so requests are spaced 1.5 seconds apart and a rate-limit reply waits a
minute before retrying. If the API still refuses partway through, the matches counted so far are
saved instead of failing the whole run.

### Where the data lives

Each daily run downloads the last published data (`npm run pull-data`), adds the new matches
(`npm run fetch-data`) and uploads the result (`npm run upload-data`) to the public `hero-data`
bucket in Supabase Storage (created by a migration in `services/accounts`):

| File                      | Use                                                            |
| ------------------------- | -------------------------------------------------------------- |
| `snapshot.json`           | The latest data. The website reads it, cached for 5 minutes.   |
| `daily/<YYYY-MM-DD>.json` | A copy per day, to compare days or roll back a bad run.        |

Public URL: `https://odigcdwsvajkbvcxeskj.supabase.co/storage/v1/object/public/hero-data/snapshot.json`.
The upload needs the project's secret key in the repo's `SUPABASE_SECRET_KEY` Actions secret
(Supabase dashboard > Project Settings > API Keys > Secret keys). Nothing else can write to the bucket.

`data/snapshot.json` in the repo is not updated anymore. It is the starting point if the bucket
is empty, and an offline copy for tests. Run `npm run pull-data` to get today's data locally.

## Development

```sh
npm test          # unit tests with a small hand-made snapshot
npm run typecheck
```
