# Accounts service

User accounts for the Dota 2 Team Picker, hosted on [Supabase](https://supabase.com) (free plan).

- **Email sign up and login** use Supabase Auth directly from the website.
- **Profiles**: one row per user with their name, picture and, for Steam users, SteamID,
  rank and per-hero record.
- **Favorite positions and heroes**: the positions each user likes and their heroes for each one.
- **Teams** for Captain mode: a captain invites friends by email (`team-invite` function), and
  picks the current team of 1 to 5 members, each on a position, per game.
- **Steam login** (`steam-login` function): signs users in through Steam, no Steam API key needed.
- **Profile sync** (`sync-profile` function): reads a Steam user's rank, name, picture and per-hero
  record from OpenDota.
- **Steam linking** (`steam-link` function): a user who signed up by email connects their Steam
  account later.

Every user can read and change only their own rows (row level security). The one exception: a
captain can read the name, rank, positions and favorite heroes of their own team's members. Users can edit their
name and picture; Steam and rank fields are written only by the server.

## Tables

| Table             | Columns                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| `profiles`        | `id`, `display_name`, `avatar_url`, `steam_id`, `rank_tier`, `hero_stats`, `synced_at`             |
| `favorite_heroes` | `user_id`, `position` (1–5, 0 = any position), `hero_id`                                     |
| `favorite_positions` | `user_id`, `position`                                                                         |
| `teams`           | `id`, `owner_id` (the captain), `name`                                                            |
| `team_members`    | `team_id`, `user_id`: added only by accepting an invite (`accept_team_invite`)                  |
| `team_invites`    | `id` (the secret in the join link), `team_id`, `email`, `accepted_at`                            |
| `team_lineups`    | `team_id`, `slots` (member id per position, null = not in the team), `rank_bracket`             |
| `steam_link_requests` | pending Steam links, used only by `steam-link`                                               |

`rank_tier` is OpenDota's number: tens digit is the medal (1 Herald ... 8 Immortal), ones digit
the star, so 54 is Legend 4. `rank_bracket(profiles)` returns just the medal, which is what the
engine takes. With the Supabase client you can select it like a column: `select("*, rank_bracket")`.

## Functions

All run on Supabase Edge Functions (Deno) and share code in `supabase/functions/_shared`.

**`steam-login`**: the website's "Sign in with Steam" button links to
`<SUPABASE_URL>/functions/v1/steam-login?next=/profile`. The function sends the user to Steam,
checks Steam's answer, creates the Supabase user on first login, syncs the profile, and sends the
browser to `<SITE_URL>/auth/confirm` with a one-time token that the website turns into a normal
session. Steam users get a placeholder email `<SteamID64>@steam.invalid` that never receives mail.

**`sync-profile`**: the website calls `supabase.functions.invoke("sync-profile")` for a signed-in
Steam user. It refreshes at most every 10 minutes. Rank and hero record only show if the user has
**Expose Public Match Data** turned on in Dota 2 (Settings > Options > Social).

**`team-invite`**: the captain's page calls `supabase.functions.invoke("team-invite", {body: {teamId,
email}})`. It saves the invite and emails a link. A friend without an account gets the **Invite**
email, one with an account gets the **Magic link** email. Both links open
`<SITE_URL>/join/<invite id>`, where the friend picks a name and password and accepts.
`get_team_invite(id)` returns what the join page shows; `accept_team_invite(id)` joins the team if
the signed-in user's email is the invited one.

**`steam-link`**: the profile page calls `supabase.functions.invoke("steam-link", {body: {next}})`
and sends the browser to the returned Steam address. Steam sends it back to the function, which
saves the SteamID on the user's profile, syncs it, and returns to `next?steam=linked` (or `taken`
when another account already uses that Steam account, `failed`, `expired`). From then on "Sign in
with Steam" opens the same account.

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
4. Team invites send email, and Supabase's built-in sender only mails your own Supabase team and
   a few per hour. Under **Authentication > Emails > SMTP Settings**, turn on custom SMTP. With a
   Gmail account: host `smtp.gmail.com`, port `465`, user your Gmail address, password a
   [Google app password](https://myaccount.google.com/apppasswords).
5. Under **Authentication > Emails > Templates**, paste `supabase/templates/invite.html` into
   **Invite user** and `supabase/templates/magic_link.html` into **Magic link**, with the subjects
   from `supabase/config.toml`. Their links go through the website so it can sign the friend in.
6. Deploy the functions and tell them where the website is:

   ```sh
   npx supabase secrets set SITE_URL=https://your-site.vercel.app
   npx supabase functions deploy
   ```

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
