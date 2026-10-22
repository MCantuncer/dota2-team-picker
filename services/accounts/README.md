# Accounts service

User accounts for the Dota 2 Team Picker, hosted on [Supabase](https://supabase.com) (free plan).

- **Email sign up and login** use Supabase Auth directly from the website.
- **Profiles**: one row per user with their name, picture and, for Steam users, SteamID,
  rank and per-hero record.
- **Favorite heroes**: the heroes each user likes to play.

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

## Local development

`supabase/config.toml` holds the settings for a local Supabase stack (needs Docker):

```sh
npx supabase start     # starts Postgres, Auth and the API, applies migrations
npx supabase db reset  # re-applies migrations from scratch
```
