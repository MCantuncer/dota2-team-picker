/**
 * Fills My Heroes from the signed-in player's own games (plan "Auto-Fill My Heroes").
 *
 *   POST /fill-heroes   (Authorization: Bearer <the player's access token>)
 *   { "by": "welcome" | "button" }
 *
 * The player is always the token's user. "welcome" is the first My Heroes visit, "button" is
 * Fill From My Games; the database decides whether a fill may run now (claim_hero_fill).
 * Returns { claimed: false } when it may not, else { claimed: true, state, added }.
 *
 * Admins can also run a dry run on any player, which saves nothing:
 *   { "dry_run": true, "user_id"?: "<uuid>" }
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { dryRun } from "../_shared/fill/dry_run.ts";
import { runFill } from "../_shared/fill/run.ts";
import { accountIdOf, fillReadDeps, fillStore } from "../_shared/fill/supabase.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
/** A dry run stops here, and a player's fill a little later (plan: 60 seconds on the welcome visit). */
const DRY_RUN_DEADLINE_MS = 45_000;
const FILL_DEADLINE_MS = 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const token = req.headers.get("Authorization")?.replace(/^Bearer /, "");
  const { data: auth } = token ? await admin.auth.getUser(token) : { data: { user: null } };
  if (!auth.user) return json({ error: "Not signed in" }, 401);

  const body = await req.json().catch(() => null) as { dry_run?: unknown; user_id?: unknown; by?: unknown } | null;
  if (body?.dry_run === true) return await adminDryRun(auth.user.id, body.user_id);
  if (body?.by !== "welcome" && body?.by !== "button") return json({ error: "by must be welcome or button" }, 400);

  const outcome = await runFill(
    auth.user.id,
    body.by,
    fillStore(admin),
    fillReadDeps(admin, AbortSignal.timeout(FILL_DEADLINE_MS)),
  ).catch((err) => {
    // Only the claim itself can land here: after it, runFill saves a failed try instead of throwing.
    console.error("Claiming the fill failed", err);
    return null;
  });
  return outcome ? json(outcome) : json({ error: "Could not start reading your games" }, 500);
});

async function adminDryRun(callerId: string, targetId: unknown): Promise<Response> {
  const { data: me, error: meError } = await admin.from("profiles").select("user_type").eq("id", callerId).single();
  if (meError) {
    console.error("Reading the caller's profile failed", meError);
    return json({ error: "Could not check your account" }, 500);
  }
  if (me.user_type !== "admin") return json({ error: "Admins only" }, 403);
  if (targetId !== undefined && (typeof targetId !== "string" || !UUID.test(targetId))) {
    return json({ error: "user_id must be a user id" }, 400);
  }
  const userId = (targetId as string | undefined) ?? callerId;

  const { data: player, error: playerError } = await admin.from("profiles").select("steam_id").eq("id", userId)
    .maybeSingle();
  if (playerError) {
    console.error("Reading the player's profile failed", playerError);
    return json({ error: "Could not read that player" }, 500);
  }
  if (!player) return json({ error: "No such player" }, 404);
  if (!player.steam_id) return json({ error: "That player has no Steam account" }, 400);

  try {
    const deps = fillReadDeps(admin, AbortSignal.timeout(DRY_RUN_DEADLINE_MS));
    return json(await dryRun(userId, accountIdOf(player.steam_id), deps));
  } catch (err) {
    console.error("The fill dry run failed", err);
    return json({ error: "The dry run failed" }, 500);
  }
}
