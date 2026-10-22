/**
 * Sign in with Steam.
 *
 *   GET /steam-login?next=/profile   sends the browser to Steam
 *   GET /steam-login/callback        Steam sends it back here
 *
 * After Steam confirms who the user is, we find or create their Supabase
 * user, refresh their rank from OpenDota, and send the browser to the
 * website's /auth/confirm page with a one-time sign-in token. The website
 * swaps that token for a normal Supabase session.
 *
 * Steam users have no real email, so each gets a placeholder address
 * <SteamID64>@steam.invalid that never receives mail.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { steamLoginUrl, verifySteamLogin } from "../_shared/steam.ts";
import { syncProfile } from "../_shared/sync.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
/** The website's address, e.g. https://your-site.vercel.app. Users are only ever sent back there. */
const SITE_URL = (Deno.env.get("SITE_URL") ?? "http://localhost:3000").replace(/\/$/, "");
/** Steam must send users back to the public address, which the request URL inside the runtime is not. */
const FUNCTION_URL = (Deno.env.get("STEAM_LOGIN_URL") ?? `${SUPABASE_URL}/functions/v1/steam-login`).replace(/\/$/, "");
const SYNC_TIMEOUT_MS = 5000;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const next = safeNext(url.searchParams.get("next"));
  const callback = `${FUNCTION_URL}/callback?${new URLSearchParams({ next })}`;

  if (!url.pathname.endsWith("/callback")) {
    return Response.redirect(steamLoginUrl(callback, new URL(FUNCTION_URL).origin), 302);
  }

  try {
    const steamId = await verifySteamLogin(url, callback);
    if (!steamId) return failed("Steam did not confirm the sign-in");

    const email = `${steamId}@steam.invalid`;
    const created = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      app_metadata: { provider: "steam", providers: ["steam"], steam_id: steamId },
    });
    if (created.error && created.error.code !== "email_exists") throw created.error;

    const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (link.error) throw link.error;

    // A slow OpenDota should not block sign-in; the profile page can sync again.
    await Promise.race([
      syncProfile(admin, link.data.user.id, steamId).catch((err) => console.error("Profile sync failed", err)),
      new Promise((resolve) => setTimeout(resolve, SYNC_TIMEOUT_MS)),
    ]);

    const confirm = new URL(`${SITE_URL}/auth/confirm`);
    confirm.searchParams.set("token_hash", link.data.properties.hashed_token);
    confirm.searchParams.set("type", "email");
    confirm.searchParams.set("next", next);
    return Response.redirect(confirm.toString(), 302);
  } catch (err) {
    console.error("Steam login failed", err);
    return failed("Steam sign-in failed");
  }
});

/** Only allow paths on our own site, so the login cannot be used to redirect elsewhere. */
function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

function failed(reason: string): Response {
  console.warn(reason);
  return Response.redirect(`${SITE_URL}/login?error=steam`, 302);
}
