/**
 * Similar Games after a draft: real Divine and up games of this patch where one of our heroes played the same
 * position against three (or two) of the same enemies, for the Similar Games answer on the Draft page.
 *
 *   POST /similar-games   (Authorization: Bearer <user's access token>)
 *   body: { ours: [{ hero, position }] x5, enemies: [hero] x5, heroes: [hero] }
 *
 * `heroes` are the ones whose games to read now (the viewer's first). Cached searches (6 hours) and matches
 * (30 days) answer at once. Otherwise one OpenDota search covers all five heroes, and STRATZ reads the missing
 * matches within 8 seconds, inside the user's 30 lookups an hour, the OpenDota budget and the shared hourly STRATZ
 * budget. Returns { heroes: [{ hero, level, found, games, pending }], reasons, retryIn? }; ask again after
 * retryIn while a hero is pending.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { postStratz } from "../_shared/matchup/stratz.ts";
import { takeOpenDotaCalls } from "../_shared/opendota_budget.ts";
import { DETAILS_VERSION, type SimilarMatch } from "../_shared/similar/details.ts";
import { lookupSimilar, parseSimilarInput } from "../_shared/similar/lookup.ts";
import { type HeroSearch, searchGames } from "../_shared/similar/search.ts";
import type { Database } from "../../database.types.ts";

/** Similar Games' share of the daily OpenDota budget: one search and, a few times a day, the patch list. */
const SIMILAR_BUDGET = { caller: "similar", dailyCap: 150 } as const;
const PATCH_FRESH_MS = 6 * 60 * 60 * 1000;

const admin = createClient<Database>(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const stratzToken = Deno.env.get("STRATZ_TOKEN");

/** The current patch's start (Unix seconds), from OpenDota's patch list, kept while this instance lives. */
let patch: { start: number; at: number } | null = null;
async function patchStart(): Promise<number | null> {
  if (patch && Date.now() - patch.at < PATCH_FRESH_MS) return patch.start;
  if (!(await takeOpenDotaCalls(admin, 1, SIMILAR_BUDGET)).ok) return patch?.start ?? null;
  const res = await fetch("https://api.opendota.com/api/constants/patch", { signal: AbortSignal.timeout(5000) });
  // Checked right below: the last entry is the current patch.
  const list = (await res.json().catch(() => null)) as { date?: unknown }[] | null;
  const start = Date.parse(String(Array.isArray(list) ? list.at(-1)?.date : "")) / 1000;
  if (!res.ok || !Number.isFinite(start)) throw new Error(`OpenDota patch list failed: HTTP ${res.status}`);
  patch = { start: Math.floor(start), at: Date.now() };
  return patch.start;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const token = req.headers.get("Authorization")?.replace(/^Bearer /, "");
  const { data: auth } = token ? await admin.auth.getUser(token) : { data: { user: null } };
  if (!auth.user) return json({ error: "Not signed in" }, 401);
  const userId = auth.user.id;

  const input = parseSimilarInput(await req.json().catch(() => null));
  if (typeof input === "string") return json({ error: input }, 400);
  if (!stratzToken) {
    console.error("STRATZ_TOKEN is not set");
    return json({ error: "Similar games are not set up" }, 503);
  }

  try {
    const start = await patchStart();
    if (start === null) return json({ error: "Too many lookups today. Try again tomorrow." }, 429);
    const result = await lookupSimilar(
      {
        now: () => Date.now(),
        async readSearch(key) {
          const { data, error } = await admin.from("similar_searches").select("answer, fetched_at")
            .eq("search_key", key).maybeSingle();
          if (error) throw error;
          // Written only by saveSearch below, from readSearch's checked answer.
          return data
            ? { heroes: (data.answer as unknown as { heroes: HeroSearch[] }).heroes, fetchedAt: data.fetched_at }
            : null;
        },
        async saveSearch(key, heroes) {
          const { error } = await admin.from("similar_searches").upsert({
            search_key: key,
            // HeroSearch is plain JSON.
            answer: { heroes } as unknown as Database["public"]["Tables"]["similar_searches"]["Insert"]["answer"],
            fetched_at: new Date().toISOString(),
          });
          if (error) throw error;
        },
        async claim(keys) {
          const { data, error } = await admin.rpc("claim_similar_fetches", { wanted: keys });
          if (error) throw error;
          return data ?? [];
        },
        async release(keys) {
          const { error } = await admin.from("similar_claims").delete().in("claim_key", keys);
          if (error) throw error;
        },
        async takeLookup() {
          const { data, error } = await admin.rpc("take_similar_lookup", { who: userId });
          if (error || data === null) throw error ?? new Error("No answer from take_similar_lookup");
          return data;
        },
        takeOpenDota: async () => (await takeOpenDotaCalls(admin, 1, SIMILAR_BUDGET)).ok,
        search: (searchInput) => searchGames(searchInput, Math.floor(Date.now() / 1000)),
        async readMatches(ids) {
          const { data, error } = await admin.from("similar_matches").select("match_id, game").in("match_id", ids);
          if (error) throw error;
          const out = new Map<number, SimilarMatch | null>();
          for (const row of data ?? []) {
            // Written only by saveMatches below: a SimilarMatch from readDetails, or { unreadable: true }.
            const game = row.game as unknown as SimilarMatch | { unreadable: true };
            if ("unreadable" in game) out.set(row.match_id, null);
            else if (game.version === DETAILS_VERSION) out.set(row.match_id, game);
          }
          return out;
        },
        async saveMatches(read, unreadable) {
          const rows = [
            ...read.map((m) => ({ match_id: m.match, game: m })),
            ...unreadable.map((id) => ({ match_id: id, game: { unreadable: true } })),
          ].map((r) => ({
            ...r,
            // SimilarMatch is plain JSON.
            game: r.game as unknown as Database["public"]["Tables"]["similar_matches"]["Insert"]["game"],
            fetched_at: new Date().toISOString(),
          }));
          const { error } = await admin.from("similar_matches").upsert(rows);
          if (error) throw error;
        },
        async stratzFreeAt() {
          const { data, error } = await admin.rpc("stratz_free_at");
          if (error) throw error;
          return data;
        },
        async noteBusy(until) {
          const { error } = await admin.rpc("note_stratz_busy", { until: new Date(until).toISOString() });
          if (error) throw error;
        },
        async takeStratz(calls) {
          const { data, error } = await admin.rpc("take_stratz_calls", { wanted: calls });
          if (error || data === null) throw error ?? new Error("No answer from take_stratz_calls");
          return data;
        },
        post: (query, timeoutMs) => postStratz(stratzToken, query, timeoutMs),
      },
      input,
      start,
    );
    return json(result);
  } catch (err) {
    console.error("Similar games failed", err);
    return json({ error: "Could not look up similar games right now" }, 500);
  }
});
