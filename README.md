<div align="center">

<img src="docs/readme/icon.svg" width="64" height="64" alt="">

# Dota 2 Team Picker: Backend

**The data and the scoring engine behind the draft assistant.**<br>
Your team's picks, the enemy picks and your position go in.<br>
Eight heroes come out, each with a short reason from this draft.

[![Live Site](https://img.shields.io/website?url=https%3A%2F%2Fdota2-team-picker-web.vercel.app&style=flat-square&label=Live%20Site&up_message=online&up_color=e8a052&down_message=offline&labelColor=1a1815&logo=vercel&logoColor=ece6da)](https://dota2-team-picker-web.vercel.app)
[![CI](https://img.shields.io/github/actions/workflow/status/MCantuncer/dota2-team-picker/ci.yml?branch=main&style=flat-square&label=CI&labelColor=1a1815&logo=githubactions&logoColor=ece6da)](https://github.com/MCantuncer/dota2-team-picker/actions/workflows/ci.yml)
[![Database](https://img.shields.io/github/actions/workflow/status/MCantuncer/dota2-team-picker/database.yml?branch=main&style=flat-square&label=Database&labelColor=1a1815&logo=postgresql&logoColor=ece6da)](https://github.com/MCantuncer/dota2-team-picker/actions/workflows/database.yml)
[![Hero Data Refresh](https://img.shields.io/github/actions/workflow/status/MCantuncer/dota2-team-picker/refresh-data.yml?branch=main&style=flat-square&label=Hero%20Data%20Refresh&labelColor=1a1815&logo=githubactions&logoColor=ece6da)](https://github.com/MCantuncer/dota2-team-picker/actions/workflows/refresh-data.yml)
[![CodeQL](https://img.shields.io/github/actions/workflow/status/MCantuncer/dota2-team-picker/codeql.yml?branch=main&style=flat-square&label=CodeQL&labelColor=1a1815&logo=github&logoColor=ece6da)](https://github.com/MCantuncer/dota2-team-picker/actions/workflows/codeql.yml)

[![TypeScript 7](https://img.shields.io/badge/TypeScript-7-3a352e?style=flat-square&labelColor=1a1815&logo=typescript&logoColor=ece6da)](https://www.typescriptlang.org)
[![Node.js 22](https://img.shields.io/badge/Node.js-22-3a352e?style=flat-square&labelColor=1a1815&logo=nodedotjs&logoColor=ece6da)](https://nodejs.org)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres%20and%20Edge%20Functions-3a352e?style=flat-square&labelColor=1a1815&logo=supabase&logoColor=ece6da)](https://supabase.com)
[![Deno](https://img.shields.io/badge/Deno-Edge%20Functions-3a352e?style=flat-square&labelColor=1a1815&logo=deno&logoColor=ece6da)](https://deno.com)
[![Vitest](https://img.shields.io/badge/Tested%20with-Vitest-3a352e?style=flat-square&labelColor=1a1815&logo=vitest&logoColor=ece6da)](https://vitest.dev)
[![Data](https://img.shields.io/badge/Data-OpenDota%20and%20STRATZ-3a352e?style=flat-square&labelColor=1a1815)](https://www.opendota.com)

<a href="https://dota2-team-picker-web.vercel.app"><img src="docs/readme/landing.jpg" width="860" alt="The website's home page: a big headline, Sign In with Steam, and an example draft where Earth Spirit is the top pick for mid against Pudge and Anti-Mage"></a>

The website lives in [dota2-team-picker-web](https://github.com/MCantuncer/dota2-team-picker-web).

</div>

## How It Fits Together

```mermaid
flowchart LR
  OD[OpenDota] --> R
  ST[STRATZ] --> R
  R["Refresh Job<br>4 times a day"] --> S[("Hero Data<br>Supabase Storage")]
  S --> W["Website<br>scores the draft in the browser"]
  W <--> DB[("Accounts<br>Supabase Postgres")]
  F["Edge Functions<br>Steam login, profile sync, reports"] <--> DB
```

## Services

Each service is its own folder under `services/`, set up as an npm workspace.

| Service | What It Does |
| --- | --- |
| [`services/engine`](services/engine) | Downloads hero data and scores picks: counters, synergy, meta at your rank, position fit and your comfort. Try it from the command line. |
| [`services/accounts`](services/accounts) | Accounts on Supabase: profiles, hero pools, friends, parties and Stacks, Steam sign-in and rank sync. |

## Quick Start

```sh
npm install     # installs every service
npm test        # tests every service
npm run suggest -w services/engine -- --pos 2 --allies "Lion:5,Juggernaut:1" --enemies "Pudge,Axe" --rank 6
```

<details>
<summary><strong>All Commands and CI</strong></summary>

```sh
npm run typecheck
npm run lint            # Deno lint + format check for the edge functions
npm run test:coverage
```

CI runs on every pull request and on `main`:

- **Engine**: type check, Vitest with a coverage floor (the run fails if coverage drops below it).
- **Accounts**: Deno lint, format check, type check and tests for the edge functions and email builder.
- **Database**: migrations, lint and row level security tests on a local Supabase stack.
- **Engine backtest**: scores the PR's engine and main's on the same saved games (report only).
- **Dependency review**: fails a pull request that adds a package with a known high or critical vulnerability.
- **CodeQL**: security scan of the TypeScript code and the workflows, also weekly.

Dependabot opens grouped update PRs for npm packages and GitHub Actions every week.

</details>

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request: it holds the code standards and the checklist
every change follows.

<sub>Match data from OpenDota and STRATZ. Hero art © Valve Corporation. Not affiliated with or endorsed by Valve.
Dota 2 is a trademark of Valve Corporation.</sub>
