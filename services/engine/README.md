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
The weights live at the top of [`src/engine/score.ts`](src/engine/score.ts).

## Data

`npm run fetch-data` downloads data from the free [OpenDota API](https://docs.opendota.com/)
into `data/snapshot.json`:

- hero list, roles and win rates per rank (`/heroStats`)
- which lanes each hero is played in (`/scenarios/laneRoles`)
- recent public matches (`/publicMatches`), counted into hero-vs-hero and same-team records

Each run adds new matches to the counts already saved and fades old ones by 3%, so the data
follows the current patch. A GitHub Action refreshes it every day. The free API allows about
60 requests a minute, so a run takes around 8 minutes.

## Development

```sh
npm test          # unit tests with a small hand-made snapshot
npm run typecheck
```
