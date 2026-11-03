/**
 * The refresh-trends job, called every 30 minutes by pg_cron (see run_refresh_trends).
 *
 *   POST /refresh-trends   (X-Job-Secret: <the shared secret in Vault and REFRESH_TRENDS_SECRET>)
 *
 * Reads the recent games of active Steam players whose check is due (from STRATZ when
 * STRATZ_TOKEN is set, and OpenDota) and opens hero pool cards (see _shared/trends/job.ts).
 * Then builds game feedback rows (player_game_facts, see _shared/feedback/fact.ts) for their
 * recent games. Returns what the run did.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { json } from "../_shared/cors.ts";
import { sameSecret } from "../_shared/job_secret.ts";
import {
  DUE_ROWS_SELECT,
  type FactRow,
  KEEP_DAYS,
  MAX_GAMES_PER_PLAYER,
  NEW_GAMES_SELECT,
  PARSE_MAX_AGE_DAYS,
  pickNewGames,
  readDueRows,
  readNewGames,
} from "../_shared/feedback/fact.ts";
import { summarizeGame } from "../_shared/feedback/summary.ts";
import { fetchMatch, fetchRecentMatches, requestParse } from "../_shared/match.ts";
import type { ItemCost } from "../_shared/report/facts.ts";
import { takeOpenDotaCalls } from "../_shared/opendota_budget.ts";
import { type HeroBenchmarks, readHeroBenchmarks } from "../_shared/trends/benchmarks.ts";
import { type CountedDraftGame, DRAFT_GAMES_SELECT, readDraftGames } from "../_shared/trends/drafts.ts";
import {
  type FactsDeps,
  MAX_FACT_CALLS,
  OpenDotaBusy,
  runTrends,
  type TrendPlayer,
  TRENDS_BUDGET,
} from "../_shared/trends/job.ts";
import { type CountedStratzGame, playerMatchesQuery, readStratzGames, STRATZ_URL } from "../_shared/trends/stratz.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const SNAPSHOT_URL = `${url}/storage/v1/object/public/hero-data/snapshot.json`;
const OPENDOTA = "https://api.opendota.com/api";
const DAY_MS = 24 * 60 * 60 * 1000;
const BENCHMARK_MAX_AGE_MS = 7 * DAY_MS;
/** Hero unit keys ("npc_dota_hero_lina") rarely change: read them once a day per worker. */
let heroKeys: { ids: Record<string, number>; at: number } | null = null;

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  const secret = Deno.env.get("REFRESH_TRENDS_SECRET");
  if (!secret) {
    console.error("REFRESH_TRENDS_SECRET is not set");
    return json({ error: "Not set up" }, 503);
  }
  if (!(await sameSecret(req.headers.get("X-Job-Secret") ?? "", secret))) return json({ error: "Forbidden" }, 401);

  const snapshot = await loadSnapshot();
  const names = heroNamesOf(snapshot);
  const items = itemCostsOf(snapshot);
  const heroIdsByKey = await loadHeroKeys();
  const result = await runTrends({
    takeCalls: async (n) => (await takeOpenDotaCalls(admin, n, TRENDS_BUDGET)).ok,
    claimPlayers: async () => {
      const { data, error } = await admin.rpc("claim_trend_players");
      if (error) throw error;
      // Safe: claim_trend_players returns these columns; pool and hero_stats are built as TrendPlayer expects.
      return data as unknown as TrendPlayer[];
    },
    fetchStratzGames,
    fetchDraftGames,
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
    facts: factsDeps(items, heroIdsByKey),
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

/** The player's games from our party drafts where their hero came from their own account. */
async function fetchDraftGames(userId: string): Promise<CountedDraftGame[]> {
  const { data, error } = await admin.from("draft_players").select(DRAFT_GAMES_SELECT).eq("user_id", userId)
    .eq("hero_source", "account").not("position", "is", null).not("party_drafts.won", "is", null);
  if (error) throw error;
  return readDraftGames(data, Date.now() / 1000);
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

type Snapshot = {
  heroes?: Record<string, { name?: unknown }>;
  items?: Record<string, { key?: unknown; cost?: unknown }>;
};

/** The hero-data snapshot, or an empty one: cards then name heroes by id and key items are left out. */
async function loadSnapshot(): Promise<Snapshot> {
  try {
    const res = await fetch(SNAPSHOT_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json() as Snapshot;
  } catch (err) {
    console.error("Loading the hero-data snapshot failed", err);
    return {};
  }
}

/** Hero names from the snapshot, for the cards' text. */
function heroNamesOf(snapshot: Snapshot): Map<number, string> {
  return new Map(
    Object.entries(snapshot.heroes ?? {}).flatMap((
      [id, h],
    ) => (typeof h.name === "string" ? [[Number(id), h.name]] : [])),
  );
}

/** Item key to id and cost from the snapshot, for key item timings. */
function itemCostsOf(snapshot: Snapshot): Record<string, ItemCost> {
  return Object.fromEntries(
    Object.entries(snapshot.items ?? {}).flatMap(([id, item]) =>
      typeof item.key === "string" && typeof item.cost === "number"
        ? [[item.key, { id: Number(id), cost: item.cost }]]
        : []
    ),
  );
}

/**
 * Hero unit key to id from OpenDota's hero constants, so a death names its killer. One call
 * from the trends budget at most once a day per worker; without it, killers are left out.
 */
async function loadHeroKeys(): Promise<Record<string, number>> {
  if (heroKeys && Date.now() - heroKeys.at < DAY_MS) return heroKeys.ids;
  try {
    if (!(await takeOpenDotaCalls(admin, 1, TRENDS_BUDGET)).ok) return heroKeys?.ids ?? {};
    const res = await fetch(`${OPENDOTA}/constants/heroes`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json() as Record<string, { id?: unknown; name?: unknown }>;
    const ids = Object.fromEntries(
      Object.values(body).flatMap((
        h,
      ) => (typeof h.name === "string" && typeof h.id === "number" ? [[h.name, h.id]] : [])),
    );
    heroKeys = { ids, at: Date.now() };
    return ids;
  } catch (err) {
    console.error("Loading hero keys failed; deaths leave their killer out", err);
    return heroKeys?.ids ?? {};
  }
}

/** player_game_facts reads and writes for the feedback part of the run. */
function factsDeps(items: Record<string, ItemCost>, heroIdsByKey: Record<string, number>): FactsDeps {
  const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString();
  return {
    purge: async () => {
      const { error } = await admin.from("player_game_facts").delete().lt("started_at", daysAgo(KEEP_DAYS));
      if (error) throw error;
    },
    dueRows: async () => {
      const { data, error } = await admin.from("player_game_facts").select(DUE_ROWS_SELECT)
        .eq("status", "waiting_parse").lte("next_try_at", new Date().toISOString())
        .order("next_try_at").limit(MAX_FACT_CALLS);
      if (error) throw error;
      return readDueRows(data);
    },
    newGames: async () => {
      const since = daysAgo(PARSE_MAX_AGE_DAYS);
      const [games, rows] = await Promise.all([
        // Enough for the newest MAX_GAMES_PER_PLAYER of a few hundred players; later runs get the rest.
        admin.from("player_games").select(NEW_GAMES_SELECT).gte("started_at", since)
          .order("started_at", { ascending: false }).limit(MAX_GAMES_PER_PLAYER * 200),
        admin.from("player_game_facts").select("user_id, match_id").gte("started_at", since),
      ]);
      if (games.error) throw games.error;
      if (rows.error) throw rows.error;
      const have = new Set(rows.data.map((r) => `${r.user_id}:${r.match_id}`));
      return pickNewGames(readNewGames(games.data), (u, m) => have.has(`${u}:${m}`), new Date())
        .slice(0, MAX_FACT_CALLS);
    },
    fetchMatch: (id) => fetchMatch(id, openDota),
    requestParse: (id) => requestParse(id, openDota),
    summarize: (match, item) =>
      summarizeGame({
        match,
        accountId: item.account_id,
        startTime: Date.parse(item.started_at) / 1000,
        position: item.position,
        items,
        heroIdsByKey,
      }),
    save: async (row: FactRow) => {
      const { error } = await admin.from("player_game_facts").upsert(row, { onConflict: "user_id,match_id" });
      if (error) throw error;
    },
    now: () => new Date(),
  };
}
