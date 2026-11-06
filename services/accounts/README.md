# Accounts service

User accounts for the Dota 2 Team Picker, hosted on [Supabase](https://supabase.com) (free plan).

- **Profiles**: one row per user with their name, picture and, for Steam users, SteamID,
  rank and per-hero record.
- **Favorite positions and heroes**: the positions each user likes and their heroes for each one.
- **Teams** (Stacks on the site): saved groups of friends, each on a position, per game.
- **Steam sign-in** (`steam-login` function): the only way to sign in, no Steam API key needed.
- **Profile sync** (`sync-profile` function): reads a Steam user's rank, name, picture and per-hero
  record from OpenDota.

Every user can read and change only their own rows (row level security). The one exception: a
captain can read the name, rank, positions and favorite heroes of their own team's members. Users can edit their
name and picture; Steam and rank fields are written only by the server.

## Tables

| Table             | Columns                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| `profiles`        | `id`, `display_name`, `avatar_url`, `user_type` (user, captain, admin), `friend_code` (the secret in the "add me" link), `steam_id`, `steam_name`, `rank_tier`, `hero_stats`, `synced_at` |
| `favorite_heroes` | `user_id`, `position` (1–5, 0 = any position), `hero_id`                                     |
| `favorite_positions` | `user_id`, `position`                                                                         |
| `teams`           | `id`, `owner_id` (the captain), `name`                                                            |
| `team_members`    | `team_id`, `user_id`, `role` (`player` or `co_captain`, set by the owner): added only by accepting an invite (`accept_team_invite`) |
| `team_invites`    | `id` (the secret in the join link), `team_id`, `email`, `sent_at` (expires 7 days later), `sent_by`, `accepted_at` |
| `team_lineups`    | `team_id`, `slots` (member id per position, null = not in the team), `rank_bracket`             |
| `friendships`     | `requester_id`, `addressee_id`, `status` (pending, accepted): one row per pair, made only through `send_friend_request` |
| `parties`         | `id`, `leader_id`, `team_id` (optional), `created_at`, `closed_at` (set when the last player leaves) |
| `party_members`   | `party_id`, `user_id`, `position` (1–5 this game, null = any), `joined_at`: 5 at most, one open party per player |
| `party_invites`   | `party_id`, `user_id`, `invited_by`, `status` (pending, accepted, declined), `created_at` |
| `party_links`     | `party_id`, `code` (the secret in the invite link), `expires_at`: closed to users, read through `party_link()` |
| `party_kicks`     | `party_id`, `user_id`: players the leader removed, who can't rejoin by link; closed to users |

`rank_tier` is OpenDota's number: tens digit is the medal (1 Herald ... 8 Immortal), ones digit
the star, so 54 is Legend 4. `rank_bracket(profiles)` returns just the medal, which is what the
engine takes. With the Supabase client you can select it like a column: `select("*, rank_bracket")`.

Friends are added on the site only (nothing is sent to Steam). Database functions, callable with
`supabase.rpc(...)` by signed-in users:

| Function | Does |
| --- | --- |
| `profile_by_friend_code(code)` | Name and avatar behind an "add me" link |
| `send_friend_request(target)` | Sends a request, or accepts theirs if they already asked; at most 50 a day |
| `accept_friend_request(requester)` | Accepts a request sent to you |
| `my_friends()` | Your friends and pending requests, both ways |
| `friend_suggestions()` | People from your teams who aren't friends yet |

Declining, cancelling and unfriending delete the `friendships` row.

Parties work like a party in Dota: anyone starts one, invites friends and teammates, and up to 5
join. The three party tables are read-only to users, are in the `supabase_realtime` publication
(so invites pop up live and the lobby updates), and change only through these functions:

| Function | Does |
| --- | --- |
| `start_party(team)` | Starts a party with you as leader (`team` optional); leaves your old one |
| `invite_to_party(target)` | Leader only: invites a friend or teammate; inviting again re-sends it; at most 60 an hour |
| `answer_party_invite(party, accept)` | Joins (if fewer than 5) or declines |
| `leave_party()` | Leaves; if you led, the next player to join leads; the last one out closes it |
| `remove_from_party(target)` | Leader only: removes a player |
| `set_party_position(want)` | The position you want this game (null = any) |
| `party_view()` | Your party's players with names and positions, leader first |
| `my_party_invites()` | Open invites to you, with who sent them and how full the party is |
| `party_link(fresh)` | Leader only: the party's invite link code, made if needed; each call keeps it working 24 more hours; `fresh` makes a new one and the old one stops working |
| `party_by_link(code)` | Whose party a live link opens, how full it is, and whether you're in it or were removed from it |
| `join_party_by_link(code)` | Joins by link, no friendship needed (if fewer than 5 and you weren't removed); leaves your old one |

## Functions

All run on Supabase Edge Functions (Deno) and share code in `supabase/functions/_shared`.

**`steam-login`**: the website's "Sign in with Steam" button links to
`<SUPABASE_URL>/functions/v1/steam-login?next=/profile`. The function sends the user to Steam,
checks Steam's answer, creates the Supabase user on first login, syncs the profile, and sends the
browser to `<SITE_URL>/auth/confirm` with a one-time token that the website turns into a normal
session. Every account gets a placeholder email `<SteamID64>@steam.invalid` that never receives mail,
so one SteamID is always one account.

**`sync-profile`**: the website calls `supabase.functions.invoke("sync-profile")` for a signed-in
Steam user. It refreshes at most every 10 minutes. Rank and hero record only show if the user has
**Expose Public Match Data** turned on in Dota 2 (Settings > Options > Social).

Any user can create teams (shown as Stacks on the site), up to 10 each, and invite friends to them.

**`draft-result`**: the draft screen's after-game card calls `supabase.functions.invoke("draft-result",
{body: {draftId, matchId?}})` for a party draft. Without `matchId` it looks for a match that started
after the draft in the recent OpenDota matches of the party's Steam players, played with one of the
draft's heroes. With `matchId` (players with a hidden profile) it checks that every
hero entered for the team played on one side of that match. It saves `match_id` and `won` on the
draft, asks OpenDota to parse the replay (replays expire after one to two weeks), and looks at most
once every 20 seconds per draft. Returns `{matchId, won}`, or `{matchId: null}` when nothing was found yet.

**`fill-heroes`** (admins only, a dry run for now): `supabase.functions.invoke("fill-heroes",
{body: {dry_run: true, user_id?}})` reads a player's last 6 months (the admin's own without `user_id`)
from STRATZ (up to 10 pages of 100 games), OpenDota (one call from its own `fill` share of the budget,
plus up to 20 benchmark calls) and our drafts, and returns which heroes the My Heroes fill rules
(`_shared/fill/rules.ts`) would add per position, the near misses, and where each game's position and
strength came from. It saves nothing.

## Account types

`profiles.user_type` is `user` (the default), `captain` (no longer needed: every user can create
teams and send invites; the value goes away once the site's Captain page is removed) or `admin`
(the admin pages). Users can't change it; set it by hand in
the dashboard's **SQL Editor**:

```sql
update public.profiles set user_type = 'admin' where steam_id = '<your SteamID64>';
```

A team's owner can also make any member a **co-captain** (`team_members.role`). Co-captains can run the draft, send and cancel invites, and remove players on that
team. Only the owner can rename or delete the team, change roles, or remove a co-captain.

## Setup

1. Create a free project at [supabase.com/dashboard](https://supabase.com/dashboard).
2. Link this folder to it and apply the schema:

   ```sh
   cd services/accounts
   npx supabase login
   npx supabase link --project-ref <your project ref>
   npx supabase db push
   ```

3. In the dashboard, under **Authentication > URL Configuration**, set **Site URL** to the
   website's address (for example `https://your-site.vercel.app`) and add
   `http://localhost:3000/**` to **Redirect URLs** for local development.
4. Under **Authentication > Sign In / Providers**, turn off **Allow new users to sign up**. Steam is
   the only way in, and `steam-login` makes accounts with the admin API, which this setting doesn't
   block. Leave the **Email** provider on: Steam sign-in finishes with a one-time email-type token.
   No email is sent, so custom SMTP and email templates aren't needed.
5. Deploy the functions and tell them where the website is:

   ```sh
   npx supabase secrets set SITE_URL=https://your-site.vercel.app
   npx supabase secrets set STRATZ_TOKEN=<your STRATZ API token>
   npx supabase functions deploy
   ```

   `STRATZ_TOKEN` is for `matchup-builds` (the skill order and talents against the draft's
   enemies). Without it that function answers 503 and the cards keep the weekly general builds.

## Local development

`supabase/config.toml` holds the settings for a local Supabase stack (needs Docker):

```sh
npx supabase start     # starts Postgres, Auth and the API, applies migrations
npx supabase db reset  # re-applies migrations from scratch
npx supabase functions serve
```

Tests and type checks for the functions run with Deno, installed by `npm install`:

```sh
npm test -w services/accounts
npm run typecheck -w services/accounts
```

### Database tests

`supabase/tests/database/` holds [pgTAP](https://pgtap.org) tests for the schema and its row level security:
who can read or change profiles, favorites, teams, members, invites and lineups. Each file signs in as
test users (`tests.sign_in_as`) and rolls back at the end, so nothing is left behind. They need Docker:

```sh
npm run db:start -w services/accounts   # Postgres only, with every migration applied
npm run db:lint -w services/accounts    # Supabase schema lint
npm run test:db -w services/accounts
npm run db:stop -w services/accounts
```

CI runs these on every pull request. A new table or policy should come with tests here; the first file
fails if any table in `public` has row level security off.

### Generated database types

`supabase/database.types.ts` holds TypeScript types for every table, view and function, generated from the
migrations. After changing a migration, regenerate and commit it (needs the local database running):

```sh
npm run db:types -w services/accounts
```

CI fails if the committed file no longer matches the migrations. The website keeps a copy and checks that it
matches this file on `main`.
