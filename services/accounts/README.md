# Accounts service

User accounts for the Dota 2 Team Picker, hosted on [Supabase](https://supabase.com) (free plan).

- **Email sign up and login** use Supabase Auth directly from the website.
- **Profiles**: one row per user with their name, picture and, for Steam users, SteamID,
  rank and per-hero record.
- **Favorite heroes**: the heroes each user likes to play.
- **Steam login** (`steam-login` function): signs users in through Steam, no Steam API key needed.
- **Profile sync** (`sync-profile` function): reads a Steam user's rank, name, picture and per-hero
  record from OpenDota.

Every user can read and change only their own rows (row level security). Users can edit their
name and picture; Steam and rank fields are written only by the server.

## Tables

| Table             | Columns                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| `profiles`        | `id`, `display_name`, `avatar_url`, `steam_id`, `rank_tier`, `hero_stats`, `synced_at`             |
| `favorite_heroes` | `user_id`, `hero_id`                                                                              |

`rank_tier` is OpenDota's number: tens digit is the medal (1 Herald ... 8 Immortal), ones digit
the star, so 54 is Legend 4. `rank_bracket(profiles)` returns just the medal, which is what the
engine takes. With the Supabase client you can select it like a column: `select("*, rank_bracket")`.

## Functions

Both run on Supabase Edge Functions (Deno) and share code in `supabase/functions/_shared`.

**`steam-login`**: the website's "Sign in with Steam" button links to
`<SUPABASE_URL>/functions/v1/steam-login?next=/profile`. The function sends the user to Steam,
checks Steam's answer, creates the Supabase user on first login, syncs the profile, and sends the
browser to `<SITE_URL>/auth/confirm` with a one-time token that the website turns into a normal
session. Steam users get a placeholder email `<SteamID64>@steam.invalid` that never receives mail.

**`sync-profile`**: the website calls `supabase.functions.invoke("sync-profile")` for a signed-in
Steam user. It refreshes at most every 10 minutes. Rank and hero record only show if the user has
**Expose Public Match Data** turned on in Dota 2 (Settings > Options > Social).

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
4. Deploy the functions and tell them where the website is:

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
