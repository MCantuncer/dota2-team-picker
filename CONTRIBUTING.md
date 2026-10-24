# Contributing

The rules every change to this repo follows. They keep the code easy to read and safe to change as it grows.
Where a tool can check a rule, CI checks it; the rest is on the author and the reviewer.

## Before you open a pull request

```sh
npm run lint        # Deno lint + format check for the edge functions
npm run typecheck
npm test
npm run test:db     # pgTAP tests, with the local database running (npm run db:start -w services/accounts)
```

After changing a migration, also run `npm run db:types -w services/accounts` and commit
`services/accounts/supabase/database.types.ts`, or the Database check fails.

Then review your own diff from top to bottom as if someone else wrote it, and fix what you find before asking for
review. The PR template has the checklist.

## Branches, commits and pull requests

- Branch from `main` as `feature/<what-it-does>` or `bugfix/<what-it-fixes>`, for example `feature/steam-login`.
- One purpose per pull request, aimed at `main`. Keep it small: under about 400 changed lines, not counting generated
  files or lockfiles. Split bigger work into PRs that each work on their own. No stacked PRs.
- Commit messages start with a verb in the imperative and say what changes, for example
  `Fail closed when the invite limit check errors`.
- Update your branch by rebasing onto `main`, not by merging `main` into it.
- Don't mix a refactor or reformat with a behaviour change; put them in separate commits or PRs.

## Code

### Types

- `strict` TypeScript everywhere, and `noUncheckedIndexedAccess` for the engine.
- Type every Supabase client with the generated `Database` types.
- No `any`. Use `unknown` and narrow it. A cast (`as X`) or non-null assertion (`!`) needs a one-line comment saying
  why it is safe, or a guard instead.

### Errors

- Check `error` on every Supabase, `fetch` and Steam/OpenDota call. Never read only `data`.
- Anything that guards access or a limit fails closed: if the check can't run, refuse the request.
- The user gets a short, plain message; the log gets the detail (`console.error("What failed", error)`).
- Don't swallow errors with an empty `catch` unless losing the value is truly fine, and say so in a comment.

### Input

- Validate data where it enters: request bodies, URL parameters, environment variables and third-party API
  responses. Check the shape once at the edge, then trust it inside.
- Never put tokens or secrets in URLs or logs.

### Structure

- Edge functions stay thin: parse and check the request, call shared helpers in `functions/_shared`, return a
  response. Shared logic (auth, clients, Steam, OpenDota) lives in `_shared` with its own tests.
- Engine logic stays pure: no network or database access inside `src/engine`, so it can be tested and copied to the
  website as is.
- Aim for files under about 300 lines and functions under about 50. When a file grows past that, split it by
  responsibility.
- One source of truth for shared values (positions, rank names, limits). Import them; don't copy them.

### Naming

- Use the product's words: draft, pick, ban, lineup, party, captain.
- Booleans read as questions: `isCaptain`, `hasSteam`, `canInvite`.
- Constants in `UPPER_SNAKE_CASE`, with the unit in the name when there is one: `REQUEST_TTL_MS`, `DAILY_LIMIT`.
- No unexplained abbreviations. `wr` is fine inside a five-line scoring helper, not in an exported name.

### Comments

- Explain why, not what. Every exported function, type and edge function gets a short doc comment saying what it is
  for and anything surprising about it.
- No commented-out code and no stray `console.log`.

### Database

- Every schema change is a new migration; never edit one that has been merged.
- Row level security on every table, with pgTAP tests in `supabase/tests/database` for who can and can't read and
  write.
- Prefer a database function (RPC) when several writes must succeed or fail together.

## Writing

These apply to code comments, docs, commit messages, PR descriptions and anything users read.

- Write plain, short sentences in the product's words.
- Never use the em dash character. Use a comma, colon, period or parentheses instead.

## Tests

- New logic gets unit tests. Test behaviour through the public function, not private details.
- A bug fix starts with a test that fails without the fix.
- New or changed tables and policies get pgTAP tests.
- The engine keeps its coverage floor; don't lower it to get a PR green.
- Never skip or delete a failing test to get green; fix the cause.

## Security and dependencies

- Secrets go in Supabase or GitHub Actions secrets, never in the repo. `.env` stays git-ignored.
- Add a dependency only when it clearly beats writing the code, and prefer well-maintained packages. Dependency
  review blocks packages with known high or critical vulnerabilities.
