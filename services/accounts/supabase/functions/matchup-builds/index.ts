/**
 * The high-rank games of each of our heroes against each enemy, for the skill order and talent
 * tree on the Game Story cards (skill order plan, "Change 2 FINAL").
 *
 *   POST /matchup-builds   (Authorization: Bearer <user's access token>)
 *   body: { ours: [{ hero, position }], theirs: [hero], version }
 *
 * Fresh cache rows answer at once. The rest are fetched from STRATZ within 8 seconds, at most
 * 20 lookups per user per hour, inside one hourly STRATZ budget, and cached for 7 days.
 * Returns { slices: [{ hero, position, enemy, games, stale }], pending: [...], reasons: [...] };
 * pending slices keep the weekly general build on the card.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { type CachedSlice, lookupMatchups, parseInput } from "../_shared/matchup/lookup.ts";
import type { MatchupGame, Slice } from "../_shared/matchup/queries.ts";
import { postStratz } from "../_shared/matchup/stratz.ts";

/** Cache rows older than this are not read; the daily job deletes them. */
const KEEP_DAYS = 14;

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const stratzToken = Deno.env.get("STRATZ_TOKEN");

const toJson = (slices: Slice[]) => slices.map((s) => ({ hero: s.hero, position: s.position, enemy: s.enemy }));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const token = req.headers.get("Authorization")?.replace(/^Bearer /, "");
  const { data: auth } = token ? await admin.auth.getUser(token) : { data: { user: null } };
  if (!auth.user) return json({ error: "Not signed in" }, 401);
  const userId = auth.user.id;

  const input = parseInput(await req.json().catch(() => null));
  if (typeof input === "string") return json({ error: input }, 400);
  if (!stratzToken) {
    console.error("STRATZ_TOKEN is not set");
    return json({ error: "Matchup lookups are not set up" }, 503);
  }

  try {
    const result = await lookupMatchups({
      async readCache(heroes, enemies, version) {
        const since = new Date(Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000).toISOString();
        const { data, error } = await admin.from("matchup_guides")
          .select("hero_id, position, enemy_id, games, fetched_at")
          .in("hero_id", heroes).in("enemy_id", enemies).eq("game_version", version).gte("fetched_at", since);
        if (error) throw error;
        return (data ?? []).map((r): CachedSlice => ({
          hero: r.hero_id,
          position: r.position,
          enemy: r.enemy_id,
          // Written only by save_matchup_guides with games from toMatchupGame.
          games: r.games as unknown as MatchupGame[],
          fetchedAt: r.fetched_at,
        }));
      },
      async takeLookup() {
        const { data, error } = await admin.rpc("take_matchup_lookup", { who: userId });
        if (error || data === null) throw error ?? new Error("No answer from take_matchup_lookup");
        return data;
      },
      async claim(slices, version) {
        const { data, error } = await admin.rpc("claim_matchup_fetches", { wanted: toJson(slices), version });
        if (error) throw error;
        // claim_matchup_fetches returns the claimed slices in the shape it was given.
        return (data ?? []) as unknown as Slice[];
      },
      async takeStratz(calls) {
        const { data, error } = await admin.rpc("take_stratz_calls", { wanted: calls });
        if (error || data === null) throw error ?? new Error("No answer from take_stratz_calls");
        return data;
      },
      async save(slices, version) {
        const { error } = await admin.rpc("save_matchup_guides", {
          slices: slices.map((s) => ({ hero: s.hero, position: s.position, enemy: s.enemy, games: s.games })),
          version,
        });
        if (error) throw error;
      },
      post: (query, timeoutMs) => postStratz(stratzToken, query, timeoutMs),
      now: () => Date.now(),
    }, input);
    return json(result);
  } catch (err) {
    console.error("Matchup builds failed", err);
    return json({ error: "Could not look up these matchups, the general builds still show" }, 500);
  }
});
