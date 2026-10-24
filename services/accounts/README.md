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
| `profiles`        | `id`, `display_name`, `avatar_url`, `user_type` (user, captain, admin), `steam_id`, `steam_name`, `rank_tier`, `hero_stats`, `synced_at` |
| `favorite_heroes` | `user_id`, `position` (1–5, 0 = any position), `hero_id`                                     |
| `favorite_positions` | `user_id`, `position`                                                                         |
| `teams`           | `id`, `owner_id` (the captain), `name`                                                            |
| `team_members`    | `team_id`, `user_id`: added only by accepting an invite (`accept_team_invite`)                  |
| `team_invites`    | `id` (the secret in the join link), `team_id`, `email`, `sent_at` (expires 7 days later), `accepted_at` |
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
email, one with an account gets the **Magic link** email. Both name the captain and the team (the
function puts them in the user's metadata, which the templates read), and both links open
`<SITE_URL>/join/<invite id>`, where the friend picks a name and password and accepts.
`get_team_invite(id)` returns what the join page shows; `accept_team_invite(id)` joins the team if
the signed-in user's email is the invited one and the invite was sent in the last 7 days.

Only captains can create teams and send invites, at most 30 a day each and one per address per
minute. See **Account types** below.

**`steam-link`**: the profile page calls `supabase.functions.invoke("steam-link", {body: {next}})`
and sends the browser to the returned Steam address. Steam sends it back to the function, which
saves the SteamID on the user's profile, syncs it, and returns to `next?steam=linked` (or `taken`
when another account already uses that Steam account, `failed`, `expired`). From then on "Sign in
with Steam" opens the same account.

**`steam-unlink`**: the My heroes page's **Disconnect** button calls it (POST, with the user's
token). It removes the SteamID and everything copied from Steam and OpenDota (Steam name, rank,
hero record, and the picture if it came from Steam). Accounts made by "Sign in with Steam" have no
other way to sign in, so they get `409` and keep their Steam account.

## Account types

`profiles.user_type` is `user` (the default), `captain` (can run Captain mode: create teams and
send invites) or `admin` (captain plus the admin pages). Users can't change it; set it by hand in
the dashboard's **SQL Editor**:

```sql
update public.profiles set user_type = 'admin' where id = '<user id from Authentication > Users>';
```

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
   a few per hour. Send through [Resend](https://resend.com) from your own domain, so inboxes can
   check the mail is genuine (SPF, DKIM, DMARC) and don't file it as spam:
   - In Resend, add the domain and add the DNS records it lists (`resend._domainkey` TXT, `send`
     MX and `send` TXT), plus a `_dmarc` TXT record such as `v=DMARC1; p=none; rua=mailto:you@example.com`.
     Verify the domain.
   - Create an API key with **Sending access** for that domain only.
   - Under **Authentication > Emails > SMTP Settings**, turn on custom SMTP: sender email
     `noreply@<your domain>`, sender name `Dota 2 Team Picker`, host `smtp.resend.com`, port `465`,
     user `resend`, password the API key.

   Resend's **Emails** page shows whether each email was delivered or bounced. A personal Gmail
   account with an [app password](https://myaccount.google.com/apppasswords) (host
   `smtp.gmail.com`, port `465`) also works for local testing, but its invites often land in spam.
5. Under **Authentication > Emails > Templates**, set each template's **Subject** and paste its
   file as the body (open the file, copy everything, paste over the old body, **Save changes**):

   | Template             | Subject                                           | File                                    |
   | -------------------- | ------------------------------------------------- | --------------------------------------- |
   | Confirm signup       | Confirm your email for Dota 2 Team Picker         | `supabase/templates/confirmation.html`  |
   | Invite user          | You're invited to a team on Dota 2 Team Picker    | `supabase/templates/invite.html`        |
   | Magic link           | Your Dota 2 Team Picker link                      | `supabase/templates/magic_link.html`    |
   | Change email address | Confirm your new email for Dota 2 Team Picker     | `supabase/templates/email_change.html`  |
   | Reset password       | Reset your Dota 2 Team Picker password            | `supabase/templates/recovery.html`      |
   | Reauthentication     | Your Dota 2 Team Picker verification code         | `supabase/templates/reauthentication.html` |

   The invite, magic link and confirm signup links go through the website's `/auth/confirm` page,
   so they work even when the email is opened on another device. The emails load the logo from
   `<Site URL>/email/logo.png` (the website's `public/email/logo.png`) and say the link expires in
   1 hour, which is the default **Email OTP Expiration**.

   The templates are built from `supabase/emails/build.ts`: change that file, run
   `npm run emails -w services/accounts`, and paste the changed files again. The tests fail if the
   files and `build.ts` (or the subjects in `config.toml`) don't match.
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
