/**
 * The network and database wiring of the My Heroes fill, shared by the fill-heroes function
 * (dry runs, the welcome visit, Fill From My Games) and the refresh-trends retry job.
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { takeOpenDotaCalls } from "../opendota_budget.ts";
import { DRAFT_GAMES_SELECT, readDraftGames } from "../trends/drafts.ts";
import { cachedBenchmarks, fetchBenchmarks, queryStratz } from "../trends/sources.ts";
import { playerMatchesQuery } from "../trends/stratz.ts";
import { type DryRunDeps, FILL_BUDGET, STRATZ_PAGE_SIZE } from "./dry_run.ts";
import { LOOKBACK_DAYS } from "./rules.ts";
import type { FillStore } from "./run.ts";

const OPENDOTA = "https://api.opendota.com/api";
const STEAM_ID_OFFSET = 76561197960265728n;
/** Each STRATZ, OpenDota or benchmark call stops here, and all of them at the fill's deadline. */
const CALL_TIMEOUT_MS = 10_000;
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

/** The SteamID64 ("765...") as the 32-bit account id STRATZ and OpenDota use. */
export function accountIdOf(steamId: string): number {
  return Number(BigInt(steamId) - STEAM_ID_OFFSET);
}

/** Reads for one fill; every network call stops at `deadline` at the latest. */
export function fillReadDeps(admin: SupabaseClient, deadline: AbortSignal): DryRunDeps {
  const signal = () => AbortSignal.any([deadline, AbortSignal.timeout(CALL_TIMEOUT_MS)]);
  return {
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
  };
}

/** The fill's database calls (claim_hero_fill, save_hero_fill, fail_hero_fill), run as the service role. */
export function fillStore(admin: SupabaseClient): FillStore {
  return {
    claim: async (userId, by) => {
      const { data, error } = await admin.rpc("claim_hero_fill", { player: userId, by });
      if (error) throw error;
      return data === true;
    },
    steamAccount: async (userId) => {
      const { data, error } = await admin.from("profiles").select("steam_id").eq("id", userId).single();
      if (error) throw error;
      return data.steam_id ? accountIdOf(data.steam_id) : null;
    },
    save: async (userId, save) => {
      const { data, error } = await admin.rpc("save_hero_fill", {
        player: userId,
        result: save.result,
        fill_positions: save.positions,
        picks: save.picks,
        positioned_games: save.positionedGames,
      });
      if (error) throw error;
      return typeof data === "number" ? data : null;
    },
    fail: async (userId) => {
      const { data, error } = await admin.rpc("fail_hero_fill", { player: userId });
      if (error) throw error;
      return typeof data === "string" ? data : null;
    },
  };
}
