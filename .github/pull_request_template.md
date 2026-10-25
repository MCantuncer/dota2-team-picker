## What and why

<!-- What this changes and the reason, in a few sentences. Link the related PR in the other repo if there is one. -->

## How it was tested

<!-- Tests added or changed, and anything checked by hand. -->

## Checklist

- [ ] One purpose, under about 400 changed lines (not counting generated files)
- [ ] Self-reviewed the whole diff and fixed what I found
- [ ] Lint, format, type check and tests pass locally
- [ ] Every Supabase and network call checks its error; access and limit checks fail closed
- [ ] Input from requests, URLs and third-party APIs is validated where it enters
- [ ] New logic has unit tests; schema or policy changes have pgTAP tests
- [ ] Migration changed: `database.types.ts` regenerated and committed
- [ ] No secrets, no commented-out code, no stray `console.log`, no em dashes
- [ ] Follows [CONTRIBUTING.md](https://github.com/MCantuncer/dota2-team-picker/blob/main/CONTRIBUTING.md)
