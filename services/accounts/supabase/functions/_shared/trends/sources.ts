/**
 * The network and cache reads behind a player's games, shared by refresh-trends and the
 * My Heroes fill: one STRATZ query, and OpenDota hero benchmarks cached in hero_benchmarks.
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { type HeroBenchmarks, readHeroBenchmarks } from "./benchmarks.ts";
import { STRATZ_URL } from "./stratz.ts";

const OPENDOTA = "https://api.opendota.com/api";
/** Cached benchmarks older than this are fetched again. */
export const BENCHMARK_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Runs one STRATZ GraphQL query and returns its `data`, or null when no STRATZ_TOKEN is set. */
export async function queryStratz(query: string, signal: AbortSignal): Promise<unknown | null> {
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
    body: JSON.stringify({ query }),
    signal,
  });
  const body = await res.json().catch(() => ({})) as { data?: unknown; errors?: { message?: string }[] };
  if (!res.ok || body.errors?.length || !body.data) {
    throw new Error(`STRATZ: ${body.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`}`);
  }
  return body.data;
}

/** The heroes' benchmarks fetched in the last BENCHMARK_MAX_AGE_MS. */
export async function cachedBenchmarks(admin: SupabaseClient, heroIds: number[]): Promise<Map<number, HeroBenchmarks>> {
  const since = new Date(Date.now() - BENCHMARK_MAX_AGE_MS).toISOString();
  const { data, error } = await admin.from("hero_benchmarks").select("hero_id, benchmarks").in("hero_id", heroIds)
    .gte("fetched_at", since);
  if (error) throw error;
  return new Map(data.map((row) => [row.hero_id, readHeroBenchmarks({ result: row.benchmarks })]));
}

/** Fetches one hero's benchmarks from OpenDota and caches them. `fetchFn` lets a caller handle 429. */
export async function fetchBenchmarks(
  admin: SupabaseClient,
  heroId: number,
  fetchFn: (url: string) => Promise<Response>,
): Promise<HeroBenchmarks> {
  const res = await fetchFn(`${OPENDOTA}/benchmarks?hero_id=${heroId}`);
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
