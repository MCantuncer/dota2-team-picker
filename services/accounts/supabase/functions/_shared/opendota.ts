/**
 * Reads a player's rank, Steam name and picture, and per-hero record from
 * OpenDota. Only works if the player has "Expose Public Match Data" turned on
 * in their Dota 2 settings; otherwise the rank and record come back empty.
 */

const API = "https://api.opendota.com/api";
/** Only count the last six months of games for the per-hero record. */
const HERO_STATS_DAYS = 180;

export interface GamesWins {
  games: number;
  wins: number;
}

export interface PlayerData {
  name: string | null;
  avatarUrl: string | null;
  /** Tens digit is the medal (1 Herald ... 8 Immortal), ones digit the star. Null when unknown. */
  rankTier: number | null;
  /** Keyed by hero id. */
  heroStats: Record<string, GamesWins>;
  /**
   * The same six months game by game, newest first, as [hero id, won (1 or 0), start time in
   * Unix seconds], so a shorter period can be counted from it. Games with no result are left out.
   */
  heroGames: HeroGame[];
}

interface PlayerResponse {
  profile?: { personaname?: string | null; avatarfull?: string | null } | null;
  rank_tier?: number | null;
}

export type HeroGame = [heroId: number, won: 0 | 1, startTime: number];

interface MatchRow {
  hero_id: number | string;
  start_time: number;
  player_slot: number;
  radiant_win: boolean | null;
}

interface HeroRow {
  hero_id: number | string;
  games: number;
  win: number;
}

export async function fetchPlayer(accountId: number, fetchFn: typeof fetch = fetch): Promise<PlayerData> {
  // Ask OpenDota to pull the newest matches. It runs in the background, so
  // this sync still reads the current data; the next one sees the update.
  await fetchFn(`${API}/players/${accountId}/refresh`, { method: "POST" })
    .then((res) => res.body?.cancel())
    .catch(() => {});

  // Same filters as the per-hero record, so the two count the same games.
  const [player, heroes, matches] = await Promise.all([
    getJson<PlayerResponse>(`${API}/players/${accountId}`, fetchFn),
    getJson<HeroRow[]>(`${API}/players/${accountId}/heroes?date=${HERO_STATS_DAYS}`, fetchFn),
    getJson<MatchRow[]>(
      `${API}/players/${accountId}/matches?date=${HERO_STATS_DAYS}&project=hero_id&project=start_time&project=player_slot&project=radiant_win`,
      fetchFn,
    ),
  ]);

  const heroStats: Record<string, GamesWins> = {};
  for (const row of heroes ?? []) {
    if (row.games > 0) heroStats[String(row.hero_id)] = { games: row.games, wins: row.win };
  }
  const heroGames: HeroGame[] = [];
  for (const m of matches ?? []) {
    const heroId = Number(m.hero_id);
    if (typeof m.radiant_win !== "boolean" || !(heroId > 0) || !Number.isFinite(m.start_time)) continue;
    // Slots 0 to 127 are Radiant, 128 and up Dire.
    const won = m.radiant_win === m.player_slot < 128;
    heroGames.push([heroId, won ? 1 : 0, m.start_time]);
  }
  heroGames.sort((a, b) => b[2] - a[2]);
  const tier = player?.rank_tier;
  return {
    name: player?.profile?.personaname ?? null,
    avatarUrl: player?.profile?.avatarfull ?? null,
    rankTier: typeof tier === "number" && tier >= 10 && tier <= 80 ? tier : null,
    heroStats,
    heroGames,
  };
}

async function getJson<T>(url: string, fetchFn: typeof fetch): Promise<T | null> {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`GET ${url} failed: HTTP ${res.status}`);
  return (await res.json()) as T | null;
}
