/**
 * Disconnects the Steam account from a user who signed up by email.
 *
 *   POST /steam-unlink   (Authorization: Bearer <user's access token>)
 *
 * Removes the SteamID and everything the profile sync copied from Steam and
 * OpenDota: Steam name, rank, hero record and a Steam picture. Accounts made
 * by "Sign in with Steam" have no other way to sign in, so they cannot
 * disconnect (409).
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { isSteamAvatar, isSteamOnlyEmail } from "../_shared/steam.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const token = req.headers.get("Authorization")?.replace(/^Bearer /, "");
  const { data: auth } = token ? await admin.auth.getUser(token) : { data: { user: null } };
  if (!auth.user) return json({ error: "Not signed in" }, 401);
  if (isSteamOnlyEmail(auth.user.email)) {
    return json({ error: "This account signs in with Steam only, so Steam can't be disconnected" }, 409);
  }

  const { data: profile, error: readError } = await admin
    .from("profiles")
    .select("avatar_url")
    .eq("id", auth.user.id)
    .single();
  if (readError) return json({ error: "Profile not found" }, 404);

  const { error } = await admin
    .from("profiles")
    .update({
      steam_id: null,
      steam_name: null,
      rank_tier: null,
      hero_stats: {},
      synced_at: null,
      ...(isSteamAvatar(profile.avatar_url) ? { avatar_url: null } : {}),
    })
    .eq("id", auth.user.id);
  if (error) {
    console.error("Steam unlink failed", error);
    return json({ error: "Could not disconnect Steam, try again" }, 500);
  }
  return json({ unlinked: true });
});
