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
| [`services/accounts`](services/accounts) | User accounts on Supabase: profiles, favorite heroes, Steam login and rank sync. |

## Development

```sh
npm install        # installs every service
npm test           # tests every service
npm run typecheck
npm run lint       # Deno lint + format check for the edge functions
npm run test:coverage
```

CI runs on every pull request and on `main`:

- **Engine**: type check, Vitest with a coverage floor (the run fails if coverage drops below it).
- **Accounts**: Deno lint, format check, type check and tests for the edge functions and email builder.
- **Dependency review**: fails a pull request that adds a package with a known high or critical vulnerability.
- **CodeQL**: security scan of the TypeScript code and the workflows, also weekly.

Dependabot opens grouped update PRs for npm packages and GitHub Actions every week.

Before opening a pull request, read [CONTRIBUTING.md](CONTRIBUTING.md): it holds the code standards and the checklist
every change follows.
