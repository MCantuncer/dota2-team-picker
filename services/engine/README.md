# Engine

Downloads hero data from OpenDota and (next) scores heroes to pick during a draft.
Run the commands below from this folder, or from the repo root with `-w services/engine`.

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
npm test          # unit tests
npm run typecheck
```
