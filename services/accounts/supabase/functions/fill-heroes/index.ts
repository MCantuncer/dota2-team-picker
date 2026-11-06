/**
 * The My Heroes fill dry run, for admins only (plan "Auto-Fill My Heroes", step B0).
 *
 *   POST /fill-heroes   (Authorization: Bearer <an admin's access token>)
 *   { "dry_run": true, "user_id"?: "<uuid>" }
 *
 * Reads the player's last 6 months (the admin's own when user_id is left out) from STRATZ,
 * OpenDota and our drafts, runs the fill rules and returns what they would add, the near
 * misses, and where every game's position came from. Saves nothing.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { dryRun, FILL_BUDGET, STRATZ_PAGE_SIZE } from "../_shared/fill/dry_run.ts";
import { LOOKBACK_DAYS } from "../_shared/fill/rules.ts";
import { takeOpenDotaCalls } from "../_shared/opendota_budget.ts";
import { DRAFT_GAMES_SELECT, readDraftGames } from "../_shared/trends/drafts.ts";
import { cachedBenchmarks, fetchBenchmarks, queryStratz } from "../_shared/trends/sources.ts";
import { playerMatchesQuery } from "../_shared/trends/stratz.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const OPENDOTA = "https://api.opendota.com/api";
const STEAM_ID_OFFSET = 76561197960265728n;
/** The whole run stops here, well inside the edge function's own limit. */
const DEADLINE_MS = 45_000;
const CALL_TIMEOUT_MS = 10_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The fields the fill reads from each OpenDota match, so the answer stays small. */
const OPENDOTA_FIELDS = [
  "hero_id",
  "start_time",
  "duration",
  "game_mode",
  "lobby_type",
  "leaver_status",
  "player_slot",
  "radiant_win",
  "lane_role",
  "is_roaming",
  "last_hits",
  "gold_per_min",
  "xp_per_min",
  "hero_damage",
  "hero_healing",
  "kills",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const token = req.headers.get("Authorization")?.replace(/^Bearer /, "");
  const { data: auth } = token ? await admin.auth.getUser(token) : { data: { user: null } };
  if (!auth.user) return json({ error: "Not signed in" }, 401);
  const { data: me, error: meError } = await admin.from("profiles").select("user_type").eq("id", auth.user.id)
    .single();
  if (meError) {
    console.error("Reading the caller's profile failed", meError);
    return json({ error: "Could not check your account" }, 500);
  }
  if (me.user_type !== "admin") return json({ error: "Admins only" }, 403);

  const body = await req.json().catch(() => null) as { dry_run?: unknown; user_id?: unknown } | null;
  if (body?.dry_run !== true) return json({ error: "Only dry runs for now: send dry_run true" }, 400);
  if (body.user_id !== undefined && (typeof body.user_id !== "string" || !UUID.test(body.user_id))) {
    return json({ error: "user_id must be a user id" }, 400);
  }
  const userId = (body.user_id as string | undefined) ?? auth.user.id;

  const { data: player, error: playerError } = await admin.from("profiles").select("steam_id").eq("id", userId)
    .maybeSingle();
  if (playerError) {
    console.error("Reading the player's profile failed", playerError);
    return json({ error: "Could not read that player" }, 500);
  }
  if (!player) return json({ error: "No such player" }, 404);
  if (!player.steam_id) return json({ error: "That player has no Steam account" }, 400);
  const accountId = Number(BigInt(player.steam_id) - STEAM_ID_OFFSET);

  const deadline = AbortSignal.timeout(DEADLINE_MS);
  const signal = () => AbortSignal.any([deadline, AbortSignal.timeout(CALL_TIMEOUT_MS)]);
  try {
    const report = await dryRun(userId, accountId, {
      fetchStratzPage: (id, skip) => queryStratz(playerMatchesQuery(id, STRATZ_PAGE_SIZE, skip), signal()),
      fetchOpenDotaMatches: async (id, days) => {
        const query = new URLSearchParams({ date: String(days) });
        for (const field of OPENDOTA_FIELDS) query.append("project", field);
        const res = await fetch(`${OPENDOTA}/players/${id}/matches?${query}`, { signal: signal() });
        if (!res.ok) throw new Error(`OpenDota matches: HTTP ${res.status}`);
        const rows = await res.json();
        return Array.isArray(rows) ? rows : [];
      },
      fetchDraftGames: async (id) => {
        const { data, error } = await admin.from("draft_players").select(DRAFT_GAMES_SELECT).eq("user_id", id)
          .eq("hero_source", "account").not("position", "is", null).not("party_drafts.won", "is", null);
        if (error) throw error;
        return readDraftGames(data, Date.now() / 1000, LOOKBACK_DAYS);
      },
      fetchRemovals: async (id) => {
        const { data, error } = await admin.from("pool_removals").select("hero_id, position").eq("user_id", id);
        if (error) throw error;
        return new Set(data.map((r) => `${r.hero_id}:${r.position}`));
      },
      cachedBenchmarks: (heroIds) => cachedBenchmarks(admin, heroIds),
      fetchBenchmarks: (heroId) => fetchBenchmarks(admin, heroId, (url) => fetch(url, { signal: signal() })),
      takeCalls: async (n) => (await takeOpenDotaCalls(admin, n, FILL_BUDGET)).ok,
      nowS: () => Date.now() / 1000,
      log: (message, err) => console.error(message, err),
    });
    return json(report);
  } catch (err) {
    console.error("The fill dry run failed", err);
    return json({ error: "The dry run failed" }, 500);
  }
});
