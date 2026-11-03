/**
 * The refresh-trends job, called every 30 minutes by pg_cron (see run_refresh_trends).
 *
 *   POST /refresh-trends   (X-Job-Secret: <the shared secret in Vault and REFRESH_TRENDS_SECRET>)
 *
 * Reads the recent games of active Steam players whose check is due (from STRATZ when
 * STRATZ_TOKEN is set, and OpenDota) and opens hero pool cards (see _shared/trends/job.ts). Returns what the run did.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { json } from "../_shared/cors.ts";
import { sameSecret } from "../_shared/job_secret.ts";
import { fetchRecentMatches } from "../_shared/match.ts";
import { takeOpenDotaCalls } from "../_shared/opendota_budget.ts";
import { type HeroBenchmarks, readHeroBenchmarks } from "../_shared/trends/benchmarks.ts";
import { OpenDotaBusy, runTrends, type TrendPlayer, TRENDS_BUDGET } from "../_shared/trends/job.ts";
import { type CountedStratzGame, playerMatchesQuery, readStratzGames, STRATZ_URL } from "../_shared/trends/stratz.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const SNAPSHOT_URL = `${url}/storage/v1/object/public/hero-data/snapshot.json`;
const OPENDOTA = "https://api.opendota.com/api";
const BENCHMARK_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  const secret = Deno.env.get("REFRESH_TRENDS_SECRET");
  if (!secret) {
    console.error("REFRESH_TRENDS_SECRET is not set");
    return json({ error: "Not set up" }, 503);
  }
  if (!(await sameSecret(req.headers.get("X-Job-Secret") ?? "", secret))) return json({ error: "Forbidden" }, 401);

  const names = await loadHeroNames();
  const result = await runTrends({
    takeCalls: async (n) => (await takeOpenDotaCalls(admin, n, TRENDS_BUDGET)).ok,
    claimPlayers: async () => {
      const { data, error } = await admin.rpc("claim_trend_players");
      if (error) throw error;
      // Safe: claim_trend_players returns these columns; pool and hero_stats are built as TrendPlayer expects.
      return data as unknown as TrendPlayer[];
    },
    fetchStratzGames,
    fetchRecentMatches: (accountId) => fetchRecentMatches(accountId, openDota),
    cachedBenchmarks,
    fetchBenchmarks,
    heroName: (id) => names.get(id) ?? `Hero ${id}`,
    save: async (userId, check) => {
      const { error } = await admin.rpc("save_trend_check", {
        target: userId,
        state: check.state,
        games: check.games,
        new_card: check.newCard,
        qualifying: check.qualifying,
      });
      if (error) throw error;
    },
    nowS: () => Date.now() / 1000,
    log: (message, err) => console.error(message, err),
  }).catch((err) => {
    console.error("The trends run failed", err);
    return null;
  });
  return result ? json(result) : json({ error: "The run failed" }, 500);
});

/** fetch for OpenDota: HTTP 429 stops the run instead of counting against a player. */
async function openDota(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status === 429) {
    await res.body?.cancel();
    throw new OpenDotaBusy();
  }
  return res;
}

/** The player's counted STRATZ games, or null when no STRATZ_TOKEN is set. */
async function fetchStratzGames(accountId: number): Promise<CountedStratzGame[] | null> {
  const token = Deno.env.get("STRATZ_TOKEN");
  if (!token) return null;
  const res = await fetch(STRATZ_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      // STRATZ asks API clients to send this user agent.
      "User-Agent": "STRATZ_API",
    },
    body: JSON.stringify({ query: playerMatchesQuery(accountId) }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await res.json().catch(() => ({})) as { data?: unknown; errors?: { message?: string }[] };
  if (!res.ok || body.errors?.length || !body.data) {
    throw new Error(`STRATZ: ${body.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`}`);
  }
  return readStratzGames(body.data, Date.now() / 1000);
}

async function cachedBenchmarks(heroIds: number[]): Promise<Map<number, HeroBenchmarks>> {
  const since = new Date(Date.now() - BENCHMARK_MAX_AGE_MS).toISOString();
  const { data, error } = await admin.from("hero_benchmarks").select("hero_id, benchmarks").in("hero_id", heroIds)
    .gte("fetched_at", since);
  if (error) throw error;
  return new Map(data.map((row) => [row.hero_id, readHeroBenchmarks({ result: row.benchmarks })]));
}

async function fetchBenchmarks(heroId: number): Promise<HeroBenchmarks> {
  const res = await openDota(`${OPENDOTA}/benchmarks?hero_id=${heroId}`);
  if (!res.ok) throw new Error(`OpenDota benchmarks: HTTP ${res.status}`);
  const benchmarks = readHeroBenchmarks(await res.json());
  const { error } = await admin.from("hero_benchmarks").upsert({
    hero_id: heroId,
    benchmarks,
    fetched_at: new Date().toISOString(),
  });
  if (error) throw error;
  return benchmarks;
}

/** Hero names from the hero-data snapshot, for the cards' text. */
async function loadHeroNames(): Promise<Map<number, string>> {
  try {
    const res = await fetch(SNAPSHOT_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const snapshot = await res.json() as { heroes?: Record<string, { name?: unknown }> };
    return new Map(
      Object.entries(snapshot.heroes ?? {}).flatMap((
        [id, h],
      ) => (typeof h.name === "string" ? [[Number(id), h.name]] : [])),
    );
  } catch (err) {
    console.error("Loading hero names failed", err);
    return new Map();
  }
}
