/**
 * Refreshes the signed-in Steam user's rank, name, picture and per-hero
 * record from OpenDota.
 *
 *   POST /sync-profile   (Authorization: Bearer <user's access token>)
 *
 * The website calls it with supabase.functions.invoke("sync-profile").
 * Syncs at most once every 10 minutes per user to stay inside OpenDota's
 * free limits.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { syncProfile } from "../_shared/sync.ts";

const MIN_INTERVAL_MS = 10 * 60 * 1000;

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const token = req.headers.get("Authorization")?.replace(/^Bearer /, "");
  const { data: auth } = token ? await admin.auth.getUser(token) : { data: { user: null } };
  if (!auth.user) return json({ error: "Not signed in" }, 401);

  const { data: profile, error } = await admin
    .from("profiles")
    .select("steam_id, display_name, avatar_url, rank_tier, synced_at")
    .eq("id", auth.user.id)
    .single();
  if (error) return json({ error: "Profile not found" }, 404);
  if (!profile.steam_id) return json({ error: "Only Steam accounts have a rank to sync" }, 400);

  const { steam_id: steamId, ...current } = profile;
  if (profile.synced_at && Date.now() - Date.parse(profile.synced_at) < MIN_INTERVAL_MS) {
    return json(current);
  }
  try {
    return json(await syncProfile(admin, auth.user.id, steamId));
  } catch (err) {
    console.error("Profile sync failed", err);
    return json({ error: "Could not reach OpenDota, try again later" }, 502);
  }
});
