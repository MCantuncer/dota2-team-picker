/**
 * When a hero and position from the player's recent games is worth a "add it to your pool?"
 * card. Built to resist luck: a 50% player scanned over 20 games should almost never get a
 * card, so we need enough games, a win rate whose 90% lower bound is still 50% or more, and
 * mostly strong games (losses included).
 */
import type { BenchmarkStat } from "./benchmarks.ts";
import { type Position, TREND_WINDOW_DAYS, type TrendGame } from "./games.ts";

export const MIN_GAMES = 5;
/** Games needed instead when the player's long record on the hero is poor. */
export const MIN_GAMES_AFTER_POOR_RECORD = 8;
/** z for a one sided 90% bound. */
const WILSON_Z = 1.645;
export const MIN_WIN_LOWER_BOUND = 0.5;
export const MIN_STRONG_SHARE = 0.6;
/** A long record counts as poor from this many games under this win rate. */
const POOR_RECORD_GAMES = 10;
const POOR_RECORD_WIN_RATE = 0.45;
const DAY_S = 24 * 60 * 60;

/** A hero in the player's pool; position 0 means any position. */
export interface PoolEntry {
  heroId: number;
  position: number;
}

/** The player's record on a hero over the last 180 days (profiles.hero_stats). */
export interface HeroRecord {
  games: number;
  wins: number;
}

/** The stat that stood out most in the candidate's games, for the reason text. */
export type Standout =
  | { kind: "imp"; averageImp: number }
  | { kind: "stat"; stat: BenchmarkStat; averagePercentile: number; averageValue: number };

/** A hero and position that qualified, with the numbers its card quotes. */
export interface PoolCandidate {
  heroId: number;
  position: Position;
  games: number;
  wins: number;
  strongGames: number;
  winLowerBound: number;
  /** Unix seconds of the newest game. */
  lastPlayed: number;
  /** True when every game's position came only from our drafts. */
  isPositionFromDraftsOnly: boolean;
  standout: Standout | null;
}

export interface FindInput {
  games: TrendGame[];
  pool: PoolEntry[];
  /** Keyed by hero id. */
  heroRecords: Record<string, HeroRecord>;
  /** Hero and position pairs with an open, snoozed or blocked card, as `${heroId}:${position}`. */
  skip: Set<string>;
  nowS: number;
}

/** Wilson score lower bound of a win rate. */
export function winLowerBound(wins: number, games: number, z = WILSON_Z): number {
  if (games <= 0) return 0;
  const p = wins / games;
  const z2 = z * z;
  const centre = p + z2 / (2 * games);
  const margin = z * Math.sqrt((p * (1 - p)) / games + z2 / (4 * games * games));
  return (centre - margin) / (1 + z2 / games);
}

export const pairKey = (heroId: number, position: number) => `${heroId}:${position}`;

/** Every qualifying hero and position, best first: lower bound, then strong share, then newest. */
export function findPoolCandidates({ games, pool, heroRecords, skip, nowS }: FindInput): PoolCandidate[] {
  const inPool = new Set(pool.map((p) => pairKey(p.heroId, p.position)));
  const since = nowS - TREND_WINDOW_DAYS * DAY_S;
  const groups = new Map<string, TrendGame[]>();
  for (const game of games) {
    if (!game.position || game.startTime < since) continue;
    const key = pairKey(game.heroId, game.position);
    if (inPool.has(key) || inPool.has(pairKey(game.heroId, 0)) || skip.has(key)) continue;
    groups.set(key, [...(groups.get(key) ?? []), game]);
  }

  const candidates: PoolCandidate[] = [];
  for (const group of groups.values()) {
    const candidate = judgeGroup(group, heroRecords);
    if (candidate) candidates.push(candidate);
  }
  return candidates.sort(
    (a, b) =>
      b.winLowerBound - a.winLowerBound ||
      b.strongGames / b.games - a.strongGames / a.games ||
      b.lastPlayed - a.lastPlayed,
  );
}

function judgeGroup(group: TrendGame[], heroRecords: Record<string, HeroRecord>): PoolCandidate | null {
  const first = group[0];
  if (!first?.position) return null;
  const record = heroRecords[String(first.heroId)];
  const isPoorRecord = record !== undefined && record.games >= POOR_RECORD_GAMES &&
    record.wins / record.games < POOR_RECORD_WIN_RATE;
  const games = group.length;
  if (games < (isPoorRecord ? MIN_GAMES_AFTER_POOR_RECORD : MIN_GAMES)) return null;

  const wins = group.filter((g) => g.isWin).length;
  const bound = winLowerBound(wins, games);
  // Unknown strength counts as not strong.
  const strongGames = group.filter((g) => g.isStrong === true).length;
  if (bound < MIN_WIN_LOWER_BOUND || strongGames / games < MIN_STRONG_SHARE) return null;

  return {
    heroId: first.heroId,
    position: first.position,
    games,
    wins,
    strongGames,
    winLowerBound: bound,
    lastPlayed: Math.max(...group.map((g) => g.startTime)),
    isPositionFromDraftsOnly: group.every((g) => g.positionSource === "draft"),
    standout: standoutOf(group),
  };
}

/** IMP when STRATZ judged at least half the games, else the stat with the best average percentile. */
export function standoutOf(group: TrendGame[]): Standout | null {
  const imps = group.flatMap((g) => (g.imp === null ? [] : [g.imp]));
  if (imps.length > 0 && imps.length * 2 >= group.length) {
    return { kind: "imp", averageImp: average(imps) };
  }
  const byStat = new Map<BenchmarkStat, { percentiles: number[]; values: number[] }>();
  for (const game of group) {
    // Safe: percentiles is keyed only by BenchmarkStat, and Object.entries widens keys to string.
    for (const [stat, percentile] of Object.entries(game.percentiles ?? {}) as [BenchmarkStat, number][]) {
      const value = game.statValues?.[stat];
      if (value === undefined) continue;
      const entry = byStat.get(stat) ?? { percentiles: [], values: [] };
      entry.percentiles.push(percentile);
      entry.values.push(value);
      byStat.set(stat, entry);
    }
  }
  let best: Standout | null = null;
  for (const [stat, { percentiles, values }] of byStat) {
    const averagePercentile = average(percentiles);
    if (!best || (best.kind === "stat" && averagePercentile > best.averagePercentile)) {
      best = { kind: "stat", stat, averagePercentile, averageValue: average(values) };
    }
  }
  return best;
}

const average = (xs: number[]) => xs.reduce((sum, x) => sum + x, 0) / xs.length;
