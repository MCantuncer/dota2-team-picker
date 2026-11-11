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
  positions are guessed from which lanes each hero is usually played in. Which enemy support is
  the 4 and which the 5 is easy to guess wrong, and supports rotate, so in a lane with an enemy
  support (every lane but mid) each enemy counts at least half its chance of being pos 4 or 5.
- **Synergy**: the same idea for the allies already picked. Your lane partner (pos 1 with 5, 3 with 4)
  counts 1.5x when its position is known.
- **Meta**: the hero's current win rate at your rank.
- **Position fit**: how often the hero is played in your position. Heroes almost never played
  there are left out.
- **Team needs**: covers something your team lacks (stuns, initiation, a save, a frontliner,
  pushing, magic or physical damage). Counts more as your team fills up.
- **Comfort**: your favorites, a small extra push for your Top 5 on the position (only heroes in your pool), and your own record on the hero when known.
- **Flex**: early in the draft, a hero that can play several positions hides your plan.
- **Pick safety**: blind pick risk ([`src/engine/risk.ts`](src/engine/risk.ts)). For each enemy position
  not picked yet, every hero still in the pool gets a chance of being their pick there (pick rate times
  how often it plays that position). The hero loses its bad matchups against them weighted by those
  chances, lane opponents 1.5x, compared with the other heroes for your position. Bans and picks take
  heroes out of the pool, so banning a hero's counters makes it safer ("Safer now: Anti-Mage is
  banned"), and a hero well above the usual risk is flagged ("Easy to punish: Axe and Legion Commander
  can still be picked"). Once the saved ranked games of this patch hold 3,000 games (`pickPhase`), how
  the hero does when its team picks it in this round of the draft is added too ("Wins more as a
  last-round pick"). The rounds follow Ranked All Pick: two picks, two picks, then the last.
- **Hard counters**: a hand-checked list ([`src/engine/hard-counters.ts`](src/engine/hard-counters.ts)) of 17
  pairs where one hero ruins another by a specific mechanic, such as Anti-Mage against Medusa. With the
  counter on the enemy team, the matchup costs at least the listed gap ("Hard countered by Anti-Mage").
  While the counter can still be picked, the hero loses the gap times the chance the enemy takes it (the same chance as in pick safety, which leaves hard counters out)
  ("Gamble: Anti-Mage still available"). Once it is banned or on your team, there is no cost and the
  reason says "Anti-Mage is out, safe to pick".
  Next to that list, the refresh finds hard counters in the match data for every hero
  ([`src/engine/data-hard-counters.ts`](src/engine/data-hard-counters.ts)): a pair where the hero does
  5 or more points worse than both heroes' win rates predict, over 1,000 or more games at all ranks,
  on two refreshes in a row, at most the 3 worst per hero. They go in `dataHardCounters` and count
  the same way; a pair already on the hand list keeps the hand list's gap.

Small samples are pulled toward the expected value, so a 3-0 matchup does not look like a sure win.

With `--rank`, counters and synergy also use games at that rank group (Herald-Guardian,
Crusader-Archon, Legend-Ancient, Divine-Immortal), since a matchup can play out differently at
Herald and at Divine. The rank group's games are pulled toward the all-ranks number rather than
toward zero, so a group with few games (Divine-Immortal is about 5% of public matches) still gets
the all-ranks result, and the rank's own pattern takes over as its games add up.
The weights live at the top of [`src/engine/score.ts`](src/engine/score.ts).


### What a card says

Each suggestion carries up to four short lines on why it fits, each with its points, and one
warning (two when it loses a matchup):

- Lines from this draft come first: "Beats Axe (+3.1, likely your lane)", "Works with Crystal
  Maiden (+1.8, your lane partner)", "Adds what your team lacks: an initiator and a save (+2.4)",
  "Safer now: Anti-Mage is banned (+0.6)", or "Hard to punish: few heroes still open beat it
  (+1.4)".
- Then one line that holds in any draft, such as "3rd best mid at Legend: 54.0% win rate" (the
  hero's place among heroes played in the position in 30% or more of their games, with 500 or more
  games at that rank, top 10).
  With no picks yet, these lines are all the card shows.
- The warning starts with "Watch out:", for example "Watch out: loses to Viper (-2.2)". A lost
  matchup of 1 point or more is always shown, next to the biggest other warning, so a low win rate
  never hides it. A named matchup with fewer than 100 games says so: "(-1.4, only 86 games)".

`summary` gives the hero's place among every hero scored for the position in this draft (also in
`place`), then splits the score into what this draft adds (counter, synergy, team needs, pick
safety) and what holds in any draft (meta, position fit, comfort, flex): "Score -3.4, 31st of 47
carries here: -5.5 from this draft, +2.1 from meta, role and comfort". Favorites and your own record go
in `tags` ("Favorite (+1.5)", "Top 5 (+0.5)", "Your record 12-8 (+0.9)").
## Backtest

`npm run backtest` scores the engine on real ranked games saved by the refresh Action (see
"Games for the backtest" below). At every pick it gives the engine only what that player saw
(bans, earlier picks, allies' positions, rank) and asks for 8 heroes for the player's position.

- **Hit top 8 / top 1**: how often the hero the player really took was suggested. This shows the
  advice is realistic, not that it is good.
- **Win lift**: win rate of players who took one of the top 3, minus the win rate of everyone
  else. This is the number that says whether the advice wins games.

Two simple rivals are scored the same way: "Most played" (most picked heroes in the position)
and "Highest win rate" (best win rate at the rank among heroes that fit the position). The engine
should beat both. Only games that started after the snapshot was built are scored, so the engine
never sees a game it learned from.

```sh
npm run pull-data -w services/engine
npm run backtest -w services/engine -- --limit 500
```

`--pick-phase` counts pick phases from the older half of the games and scores the newer half, with
an "Engine with pick phase" row to compare. CI runs it too.

On every pull request that changes the engine, CI scores the PR's engine and main's on the same
saved games and puts both tables in the "Engine backtest" job summary, so an engine change shows
its effect before it merges. PRs that don't touch the engine skip it, since both sides would print
the same tables.

## Fixed drafts

`npm run compare-drafts` prints the top 8 suggestions, with their reasons, for a fixed set of drafts
(an empty board, bans only, then 1 v 1 up to 4 v 4 across positions; listed in
[`src/backtest/compare-drafts.ts`](src/backtest/compare-drafts.ts)). To see how a change moves them,
save the old engine's run and pass it to the new one:

```sh
npm run compare-drafts -w services/engine -- --json before.json   # on main
npm run compare-drafts -w services/engine -- --before before.json # on your branch
```

On every pull request that changes the engine, CI runs both on the live hero data and puts main's
list beside the PR's in the "Engine backtest" job summary, with how many heroes changed in each
draft.

## Win chance

`draftEdge` (in `src/engine/win-chance.ts`) adds up how much better one side's draft is, in win-rate
points: the heroes' win rates, their matchups against each other (a hard counter always counts its
full gap) and the synergy inside each team. `winChance` turns that edge into a chance with one
logistic curve per draft step (2, 4, 6, 8 or 10 heroes known), because a draft with 2 heroes says
much less than one with 10.

`npm run fit-win-chance` fits the curves on this patch's saved games and checks them on the newest
quarter: games are grouped in 5-point bands of the shown chance, and every band with at least 100
draft steps must win within 2 points of what it showed, with a log loss better than a coin flip.
Only a model that passes is saved as `winModel` in the snapshot; without one, `winChance` returns
null and nothing is shown. The refresh Action refits it on every run and puts the check table in
its job summary.

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

## Game plan

Once all ten heroes are in, `gamePlan` (in [`src/engine/game-plan.ts`](src/engine/game-plan.ts)) gives the
captain's team:

- **Lanes**: our heroes in each lane against the enemy heroes most likely there (guessed from where each
  hero is usually played), and whether the lane is won, even or hard by matchup data.
- **Win condition and roadmap**: each team's style from the WCST lists (teamfight, push, pick-off, late
  game), whether they outscale us or want an early game, and what to do in laning, mid game and late game.
- **Fears**: the enemy hero who beats the most of our heroes, enemy combos and hard counters to our heroes.
- **Item builds**: `itemBuild` (in [`src/engine/item-build.ts`](src/engine/item-build.ts)) starts from the items
  players really buy on the hero (`itemBuilds`), keeps one pair of boots and the finished items in buying
  order, then moves a counter item up or adds it as situational when the enemy lineup calls for it: BKB
  against three or more disablers, Monkey King Bar against evasion, Spirit Vessel against healing, Force Staff
  or Ghost Scepter for supports against physical carries, and so on. A counter item only goes in when at
  least 10% as many players buy it on that hero as buy its most common item, so a hero never gets an item
  nobody builds on it. Each change says which enemy heroes it answers.


`npm run fetch-data` downloads data from the free [OpenDota API](https://docs.opendota.com/)
into `data/snapshot.json`:

- hero list, roles and win rates per rank (`/heroStats`)
- which lanes each hero is played in (`/scenarios/laneRoles`)
- recent public matches (`/publicMatches`), counted into hero-vs-hero and same-team records,
  for all ranks and again for the match's rank group (`rankMatchups`, `rankSynergy`)
- the patch list (`/constants/patch`)
- the shop's items (`/constants/items`) and how often each hero buys each item before the horn,
  up to 10 minutes, up to 25 and after (`/heroes/{id}/itemPopularity`), for the item builds in the
  game plan (`items`, `itemBuilds`)

and, when the `STRATZ_TOKEN` secret is set, games per position (pos 1-5) for every hero over the
last week from the [STRATZ API](https://stratz.com/api). STRATZ detects each player's real
position, so a roaming pos 4 (Riki, Earth Spirit) no longer looks like a mid the way OpenDota's
lane data makes it look. A hero with fewer than 200 STRATZ games falls back to lane data. If STRATZ
is down, the run keeps the last positions and carries on.

With the token, the hero-vs-hero and same-team counts come from STRATZ too
([`src/data/stratz-matchups.ts`](src/data/stratz-matchups.ts)): `heroStats.matchUp` for every hero,
all ranks and each rank group (Herald-Guardian up to Divine-Immortal), 10 heroes per query. These are
every ranked game of recent weeks, a median of about 1,100 games per pair at all ranks, where our own
public match sample has about 135 (Medusa vs Nyx Assassin: 56 games in our sample, 1,547 at STRATZ,
39.4% for Medusa). The STRATZ counts replace all four count fields at once (`matchupsFrom` says
so) or not at all: each hero's expected win rate comes from the same rows as its pairs, so the two
sources are never mixed. While the counts come from STRATZ, they are replaced on each run instead
of faded, and the public match sample below is skipped. If STRATZ fails, the run keeps the last
counts and warns when they are over 48 hours old.

It also counts, from the saved ranked games of this patch (see "Games for the backtest"), how each
hero does by the round its team picked it in, as in Ranked All Pick: 1st or 2nd pick, 3rd or 4th,
or 5th. A hero that wins much less as a first-round pick is easy to counter and safer to pick late. These counts go in `pickPhase`.

The Action can be started by hand with **dry run** ticked to fetch and build the data without
uploading it, for example to test a change on a branch.

Without STRATZ counts, each run adds new matches to the counts already saved and fades old ones by 1% per day since
the last run, so the data follows the meta as players find new builds. Fading changes how much
old games count, not the win rates they show. Lane roles take one request per hero and change
slowly, so they are downloaded once a week. Item builds also take one request per hero and are
downloaded once a day.

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
| `eval/matches-<YYYY-MM>.json` | Ranked games saved for the backtest (see below).          |

Public URL: `https://odigcdwsvajkbvcxeskj.supabase.co/storage/v1/object/public/hero-data/snapshot.json`.
The upload needs the project's secret key in the repo's `SUPABASE_SECRET_KEY` Actions secret
(Supabase dashboard > Project Settings > API Keys > Secret keys). Nothing else can write to the bucket.

`data/snapshot.json` in the repo is not updated anymore. It is the starting point if the bucket
is empty, and an offline copy for tests. Run `npm run pull-data` to get today's data locally.

### Dangerous heroes

Once a week the refresh reads about a million ranked All Pick games from the last 10 days (never from
before the patch) from the OpenDota explorer, one query per day, and finds the heroes whose games swing on
whether the other team answers them ([`src/engine/threat.ts`](src/engine/threat.ts), saved as `threatPlans`).
The games are split three ways by match id, so nothing is checked on the games it was chosen on:

1. A hero's answers are the enemies he plays 3 or more points below what both heroes' win rates predict.
2. He gets a plan when, against teams with two or more answers, he plays at least 4 points further below
   the expected win rate (from all ten heroes) than against teams with none, at the low end of its 95% range.
3. The site shows his win rate against teams with 0, 1 and 2+ answers from the third split, and his win rate
   by game length next to the average position 1 hero.

There is no hand list: the settings are fixed in the file, and the heroes change only with the games.
If the explorer fails or returns fewer than 300,000 games, the last plans stay.

For one draft, [`src/engine/threat-plan.ts`](src/engine/threat-plan.ts) picks the enemy core (likely position 1
to 3) with the biggest drop and gathers only measured facts: his answers on your team and which step that is,
open answers for each empty seat (heroes with at least 20% of their games there, only where the pick engine's
own matchup says he does worse against them), his whole lane with each of your laners in it next to his usual
lane (STRATZ), when he finishes his big item with the win rates of early and late games, and the length line.
Other dangerous enemy cores in the draft get one line each.

### Games for the backtest

After the upload, each run also saves about 100 new ranked All Pick games
(`npm run collect-matches -- --max 100`), one file per month under `eval/`. For each game it keeps
the order the 10 heroes were picked in, the bans, the average rank, who won, and each player's
position from STRATZ (OpenDota only knows positions for parsed replays). STRATZ may not have placed
a game that just ended, so later runs ask again for games up to 3 days old that still miss
positions. The backtest scores the engine on these games, so they are kept apart from the counts in
the snapshot. Each game costs one OpenDota request, and the step stops when fewer than 300 requests
are left for the day. If this step fails, the hero data above is already uploaded.

## Development

```sh
npm test          # unit tests with a small hand-made snapshot
npm run typecheck
```
