/**
 * Which heroes fill a player's My Heroes from their own games (plan "Auto-Fill My Heroes",
 * /mnt/project-files/auto-fill-heroes/plan.md). Pure: no network or database.
 *
 * A hero goes in on a position when the player plays it there a lot, or rarely but with strong
 * evidence. There is no hard win rate cut: the worse the player does on a hero compared with
 * their own average on that position, the more games it needs (Can, 2026-11-06).
 */
import type { Position } from "../trends/games.ts";
import { winLowerBound } from "../trends/rules.ts";

export const LOOKBACK_DAYS = 180;
export const RECENT_DAYS = 90;
/** A position is the player's from this share of their positioned games and this many games. */
export const POSITION_SHARE = 0.1;
export const POSITION_MIN_GAMES = 15;
/** With no position over the bar, the most played one counts from this many games. */
export const POSITION_FALLBACK_MIN_GAMES = 5;
/** Fewer positioned games than this fill nothing. */
export const MIN_POSITIONED_GAMES = 20;
/** The base bar of a Regular hero: the larger of this and BASE_SHARE of the position's games. */
export const BASE_MIN_GAMES = 8;
export const BASE_SHARE = 0.05;
export const MIN_REGULAR_GAMES = 6;
export const REGULAR_RECENT_GAMES = 3;
/** Games needed = base bar x (1 - FACTOR_SLOPE x success), kept inside these bounds. */
export const FACTOR_SLOPE = 6;
export const FACTOR_MIN = 0.6;
export const FACTOR_MAX = 3;
/** Pseudo games pulling a hero's rates toward the position average, and a position's toward the overall one. */
export const HERO_PRIOR_GAMES = 10;
export const POSITION_PRIOR_GAMES = 20;
/** How much the strong game share counts next to the win rate in success. */
export const STRONG_WEIGHT = 0.5;
export const PROVEN_MIN_GAMES = 4;
export const PROVEN_LOWER_BOUND = 0.5;
export const PROVEN_STRONG_SHARE = 0.75;
export const MAX_PROVEN_PER_POSITION = 1;
export const MAX_PER_POSITION = 8;
/** A game this old counts half when ordering heroes for the cap. */
export const HALF_LIFE_DAYS = 90;
const DAY_S = 24 * 60 * 60;

/** One counted game of the player, merged from STRATZ, OpenDota and our drafts. */
export interface FillGame {
  heroId: number;
  /** Unix seconds. */
  startTime: number;
  isWin: boolean;
  position: Position | null;
  /** Null when no source could judge the game. */
  isStrong: boolean | null;
}

export type PickKind = "regular" | "proven";

/** A hero that goes into the player's list for a position, with the numbers its reason quotes. */
export interface FillPick {
  heroId: number;
  position: Position;
  kind: PickKind;
  games: number;
  wins: number;
  strongGames: number;
  judgedGames: number;
  /** Unix seconds of the newest game. */
  lastPlayed: number;
  /** Games a Regular hero needed at its record (rounded up); null for Proven. */
  gamesNeeded: number | null;
}

/** A hero that came close, and why it stayed out (for the dry run). */
export interface NearMiss extends Omit<FillPick, "kind"> {
  why: string;
}

export interface FillInput {
  games: FillGame[];
  nowS: number;
  /** Heroes the player removed, as `${heroId}:${position}`; a removed position is `0:${position}`. */
  removed?: Set<string>;
}

export interface FillResult {
  /** "too_few" when fewer than MIN_POSITIONED_GAMES games have a position. */
  state: "ok" | "too_few";
  games: number;
  positionedGames: number;
  gamesByPosition: Record<Position, number>;
  positions: Position[];
  picks: FillPick[];
  nearMisses: NearMiss[];
}

const POSITIONS: Position[] = [1, 2, 3, 4, 5];
const key = (heroId: number, position: number) => `${heroId}:${position}`;

/** The heroes and positions to fill from the player's games, best first within each position. */
export function fillHeroes({ games, nowS, removed = new Set() }: FillInput): FillResult {
  const counted = games.filter((g) => g.startTime >= nowS - LOOKBACK_DAYS * DAY_S);
  const positioned = counted.filter((g): g is FillGame & { position: Position } => g.position !== null);
  const gamesByPosition = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<Position, number>;
  for (const g of positioned) gamesByPosition[g.position]++;
  const result: FillResult = {
    state: "ok",
    games: counted.length,
    positionedGames: positioned.length,
    gamesByPosition,
    positions: [],
    picks: [],
    nearMisses: [],
  };
  if (positioned.length < MIN_POSITIONED_GAMES) return { ...result, state: "too_few" };

  result.positions = playerPositions(gamesByPosition, positioned.length).filter((p) => !removed.has(key(0, p)));
  const overall = rates(counted);
  for (const position of result.positions) {
    const onPosition = positioned.filter((g) => g.position === position);
    const { picks, nearMisses } = judgePosition(
      position,
      onPosition,
      positionAverages(onPosition, overall),
      nowS,
      removed,
    );
    result.picks.push(...picks);
    result.nearMisses.push(...nearMisses);
  }
  return result;
}

function playerPositions(byPosition: Record<Position, number>, total: number): Position[] {
  const mine = POSITIONS.filter((p) => byPosition[p] >= POSITION_MIN_GAMES && byPosition[p] / total >= POSITION_SHARE);
  if (mine.length > 0) return mine;
  const top = [...POSITIONS].sort((a, b) => byPosition[b] - byPosition[a])[0];
  return top && byPosition[top] >= POSITION_FALLBACK_MIN_GAMES ? [top] : [];
}

interface Rates {
  winRate: number;
  strongShare: number;
}

/** Win rate over all games and strong share over the judged ones (0.5 and 0 when there are none). */
function rates(games: FillGame[]): Rates {
  const judged = games.filter((g) => g.isStrong !== null);
  return {
    winRate: games.length ? games.filter((g) => g.isWin).length / games.length : 0.5,
    strongShare: judged.length ? judged.filter((g) => g.isStrong).length / judged.length : 0,
  };
}

/** The player's own rates on a position, pulled toward their overall rates by POSITION_PRIOR_GAMES. */
function positionAverages(games: FillGame[], overall: Rates): Rates {
  const judged = games.filter((g) => g.isStrong !== null);
  return {
    winRate: shrink(games.filter((g) => g.isWin).length, games.length, overall.winRate, POSITION_PRIOR_GAMES),
    strongShare: shrink(
      judged.filter((g) => g.isStrong).length,
      judged.length,
      overall.strongShare,
      POSITION_PRIOR_GAMES,
    ),
  };
}

const shrink = (hits: number, n: number, prior: number, priorGames: number) =>
  (hits + priorGames * prior) / (n + priorGames);

function judgePosition(position: Position, games: FillGame[], average: Rates, nowS: number, removed: Set<string>) {
  const baseBar = Math.max(BASE_MIN_GAMES, BASE_SHARE * games.length);
  const byHero = new Map<number, FillGame[]>();
  for (const g of games) {
    if (removed.has(key(g.heroId, position))) continue;
    byHero.set(g.heroId, [...(byHero.get(g.heroId) ?? []), g]);
  }
  const regular: { pick: FillPick; order: number }[] = [];
  const proven: FillPick[] = [];
  const nearMisses: NearMiss[] = [];
  for (const [heroId, list] of byHero) {
    const base = numbers(heroId, position, list);
    const recent = list.filter((g) => g.startTime >= nowS - RECENT_DAYS * DAY_S).length;
    const success = successOf(base, average);
    const needed = Math.max(MIN_REGULAR_GAMES, baseBar * clamp(1 - FACTOR_SLOPE * success, FACTOR_MIN, FACTOR_MAX));
    if (base.games >= needed && recent >= REGULAR_RECENT_GAMES) {
      const order = recencyWeight(list, nowS) * Math.max(0.1, 1 + 3 * success);
      regular.push({ pick: { ...base, kind: "regular", gamesNeeded: Math.ceil(needed) }, order });
    } else if (base.games >= baseBar && recent >= REGULAR_RECENT_GAMES) {
      nearMisses.push({
        ...base,
        gamesNeeded: Math.ceil(needed),
        why: `needs ${Math.ceil(needed)} games at this record`,
      });
    } else if (base.games >= PROVEN_MIN_GAMES) {
      const why = provenProblem(base, nowS);
      if (why === null) proven.push({ ...base, kind: "proven", gamesNeeded: null });
      else if (base.wins / base.games >= 0.6) nearMisses.push({ ...base, gamesNeeded: null, why });
    }
  }
  proven.sort((a, b) => winLowerBound(b.wins, b.games) - winLowerBound(a.wins, a.games) || b.lastPlayed - a.lastPlayed);
  for (const extra of proven.slice(MAX_PROVEN_PER_POSITION)) {
    nearMisses.push({ ...extra, why: `only ${MAX_PROVEN_PER_POSITION} rare hero per position` });
  }
  const ordered = [
    ...regular.sort((a, b) => b.order - a.order).map((r) => r.pick),
    ...proven.slice(0, MAX_PROVEN_PER_POSITION),
  ];
  for (const cut of ordered.slice(MAX_PER_POSITION)) {
    nearMisses.push({ ...cut, why: `past the ${MAX_PER_POSITION} hero cap` });
  }
  return { picks: ordered.slice(0, MAX_PER_POSITION), nearMisses };
}

function numbers(heroId: number, position: Position, games: FillGame[]) {
  return {
    heroId,
    position,
    games: games.length,
    wins: games.filter((g) => g.isWin).length,
    strongGames: games.filter((g) => g.isStrong === true).length,
    judgedGames: games.filter((g) => g.isStrong !== null).length,
    lastPlayed: Math.max(...games.map((g) => g.startTime)),
  };
}

/** How much better (above 0) or worse the player does on the hero than on the position as a whole. */
function successOf(hero: ReturnType<typeof numbers>, average: Rates): number {
  const winRate = shrink(hero.wins, hero.games, average.winRate, HERO_PRIOR_GAMES);
  const strongShare = shrink(hero.strongGames, hero.judgedGames, average.strongShare, HERO_PRIOR_GAMES);
  return winRate - average.winRate + STRONG_WEIGHT * (strongShare - average.strongShare);
}

/** Why a rarely played hero is not Proven, or null when it is. */
function provenProblem(hero: ReturnType<typeof numbers>, nowS: number): string | null {
  if (winLowerBound(hero.wins, hero.games) < PROVEN_LOWER_BOUND) {
    return `${hero.wins} wins of ${hero.games}: not enough for a rare hero`;
  }
  if (hero.lastPlayed < nowS - RECENT_DAYS * DAY_S) return `not played in ${RECENT_DAYS} days`;
  if (hero.judgedGames < hero.games) return "strength unknown for some games";
  const strongNeeded = hero.games === PROVEN_MIN_GAMES ? hero.games : Math.ceil(PROVEN_STRONG_SHARE * hero.games);
  if (hero.strongGames < strongNeeded) {
    return `${hero.wins} wins of ${hero.games} but only ${hero.strongGames} strong games`;
  }
  return null;
}

const recencyWeight = (games: FillGame[], nowS: number) =>
  games.reduce((sum, g) => sum + 0.5 ** ((nowS - g.startTime) / DAY_S / HALF_LIFE_DAYS), 0);

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
