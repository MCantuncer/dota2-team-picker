# Dota 2 Team Picker: backend

Suggests the best heroes to pick during a Dota 2 draft, for the position you are playing.
You enter your team's picks (with positions), the enemy picks (positions unknown) and your
position, and it returns 8 heroes with a short reason for each.

This repo holds the backend. The website lives in a separate client repo.

## Services

Each service is its own folder under `services/`, set up as an npm workspace.

| Service                               | What it does                                             |
| ------------------------------------- | -------------------------------------------------------- |
| [`services/engine`](services/engine)  | Downloads hero data from OpenDota daily and scores picks.|
| [`services/accounts`](services/accounts) | User accounts on Supabase: profiles and favorite heroes. |

## Development

```sh
npm install        # installs every service
npm test           # tests every service
npm run typecheck
```
