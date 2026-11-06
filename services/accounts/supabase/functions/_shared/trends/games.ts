/**
 * A player's recent games as the hero pool trend rules read them, and the reader for
 * OpenDota's /players/{id}/recentMatches rows. Pure: no network or database.
 */
import type { BenchmarkStat } from "./benchmarks.ts";

/** 1 carry, 2 mid, 3 offlane, 4 soft support, 5 hard support. */
export type Position = 1 | 2 | 3 | 4 | 5;

/** Where a game's position came from, most trusted first: our draft, STRATZ, OpenDota lanes. */
export type PositionSource = "draft" | "stratz" | "opendota";

/** One of the player's games, merged from every source we have for it. */
export interface TrendGame {
  matchId: number;
  heroId: number;
  /** Unix seconds. */
  startTime: number;
  isWin: boolean;
  /** Null when no source could tell the position. */
  position: Position | null;
  positionSource: PositionSource | null;
  /** True for a strong game, false for an ordinary one, null when we can't tell. */
  isStrong: boolean | null;
  /** STRATZ IMP (0 is an average game), when STRATZ had the game. */
  imp: number | null;
  /** Percentile (0 to 1) per stat against the hero's OpenDota benchmarks, when we had them. */
  percentiles: Partial<Record<BenchmarkStat, number>> | null;
  /** The per minute values behind the percentiles, for the card's reason. */
  statValues: Partial<Record<BenchmarkStat, number>> | null;
}

/** All Pick, Captains Mode, Random Draft, Single Draft, Ranked All Pick. No Turbo or event modes. */
export const COUNTED_GAME_MODES: readonly number[] = [1, 2, 3, 4, 22];
/** Normal and ranked matchmaking. */
export const COUNTED_LOBBY_TYPES: readonly number[] = [0, 7];
/** Shorter games are mostly remakes and early abandons. */
export const MIN_GAME_DURATION_S = 12 * 60;
export const TREND_WINDOW_DAYS = 30;
const DAY_S = 24 * 60 * 60;

/** The fields we use from one OpenDota recentMatches row, checked. */
export interface RecentMatch {
  matchId: number;
  heroId: number;
  startTime: number;
  durationS: number;
  gameMode: number;
  lobbyType: number;
  isWin: boolean;
  hasLeaver: boolean;
  /** 1 safe, 2 mid, 3 off, 4 jungle. Null when OpenDota hasn't parsed the match. */
  laneRole: number | null;
  isRoaming: boolean;
  lastHits: number;
  goldPerMin: number;
  xpPerMin: number;
  heroDamage: number;
  heroHealing: number;
  kills: number;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const num = (o: Obj, key: string): number => (isNum(o[key]) ? o[key] : 0);

/**
 * Reads one recentMatches row. Returns null when the row lacks what every rule needs
 * (id, hero, slot, result, start, duration), so one odd row never breaks the whole list.
 */
export function readRecentMatch(raw: unknown): RecentMatch | null {
  if (!isObj(raw)) return null;
  const { match_id, hero_id, player_slot, radiant_win, start_time, duration } = raw;
  if (
    !isNum(match_id) || !isNum(hero_id) || hero_id <= 0 || !isNum(player_slot) ||
    typeof radiant_win !== "boolean" || !isNum(start_time) || !isNum(duration) || duration <= 0
  ) {
    return null;
  }
  return {
    matchId: match_id,
    heroId: hero_id,
    startTime: start_time,
    durationS: duration,
    gameMode: num(raw, "game_mode"),
    lobbyType: num(raw, "lobby_type"),
    // Slots 0 to 127 are Radiant.
    isWin: (player_slot < 128) === radiant_win,
    hasLeaver: num(raw, "leaver_status") !== 0,
    laneRole: isNum(raw.lane_role) ? raw.lane_role : null,
    isRoaming: raw.is_roaming === true,
    lastHits: num(raw, "last_hits"),
    goldPerMin: num(raw, "gold_per_min"),
    xpPerMin: num(raw, "xp_per_min"),
    heroDamage: num(raw, "hero_damage"),
    heroHealing: num(raw, "hero_healing"),
    kills: num(raw, "kills"),
  };
}

/** True for a normal or ranked game in a draft mode, with no leaver, long enough and inside the window. */
export function isCountedGame(match: RecentMatch, nowS: number, windowDays = TREND_WINDOW_DAYS): boolean {
  return (
    COUNTED_GAME_MODES.includes(match.gameMode) &&
    COUNTED_LOBBY_TYPES.includes(match.lobbyType) &&
    !match.hasLeaver &&
    match.durationS >= MIN_GAME_DURATION_S &&
    match.startTime >= nowS - windowDays * DAY_S
  );
}

/**
 * Guesses the position from OpenDota's lane data, which knows lanes, not positions. Farm
 * per minute tells a core from the support sharing its lane; the middle ground stays
 * unknown rather than guessed. Unparsed matches (no lane) and the jungle are unknown.
 */
export function positionFromLane(match: RecentMatch): Position | null {
  const lastHitsPerMin = match.lastHits / (match.durationS / 60);
  if (match.isRoaming) return 4;
  switch (match.laneRole) {
    case 1:
      return lastHitsPerMin >= 3 ? 1 : lastHitsPerMin < 1.5 ? 5 : null;
    case 2:
      return lastHitsPerMin >= 3 ? 2 : null;
    case 3:
      return lastHitsPerMin >= 2.5 ? 3 : lastHitsPerMin < 1.5 ? 4 : null;
    default:
      return null;
  }
}

/** The per minute values the benchmarks compare, from one recentMatches row. */
export function statValuesOf(match: RecentMatch): Record<BenchmarkStat, number> {
  const minutes = match.durationS / 60;
  return {
    gold_per_min: match.goldPerMin,
    xp_per_min: match.xpPerMin,
    last_hits_per_min: match.lastHits / minutes,
    hero_damage_per_min: match.heroDamage / minutes,
    kills_per_min: match.kills / minutes,
    hero_healing_per_min: match.heroHealing / minutes,
  };
}
