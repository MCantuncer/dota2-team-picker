/**
 * Picks the games Similar Games answers with, from a hero's search (search.ts) and the stored matches
 * (details.ts): walking the search's games most similar first, a game counts when the hero played the asked
 * position, at most GAMES_PER_ACCOUNT per Steam account, until ROLE_GOAL games. Games not read yet on the way are
 * the ones to fetch next. Pure, so the lookup and its tests share it.
 */
import type { Lane, SimilarMatch, SimilarPlayer } from "./details.ts";
import type { HeroSearch, SearchGame } from "./search.ts";

/** Role games a hero's answer aims for; the What Won targets need at least 20. */
export const ROLE_GOAL = 20;
/** At most this many of the most similar games are read per hero (5 STRATZ queries). */
export const MAX_CANDIDATES = 100;
/** At most this many games of one Steam account per hero, so one player can't fill the sample. */
export const GAMES_PER_ACCOUNT = 2;

/** One seat of a similar game. */
export interface SimilarSeat {
  hero: number;
  position: number | null;
  lane: Lane | null;
}

/** One game as the browser gets it: the same shape as SimilarGame in the engine's similar-games.ts. No accounts. */
export interface SimilarGame {
  match: number;
  won: boolean;
  startTime: number;
  duration: number;
  sharedEnemies: number;
  sharedAllies: number;
  position: number | null;
  lane: Lane | null;
  kills: number;
  deaths: number;
  assists: number;
  networth: number;
  lastHits10: number | null;
  buys: [number, number][];
  deathsAt: [number, number | null][];
  allies: SimilarSeat[];
  enemies: SimilarSeat[];
}

export interface HeroPick {
  /** Role games picked so far, most similar first. */
  games: SimilarGame[];
  /** Games not read yet that come before the goal was reached, most similar first. */
  missing: number[];
}

const seat = (p: SimilarPlayer): SimilarSeat => ({ hero: p.hero, position: p.position, lane: p.lane });

/** The hero's game in a stored match, or null when he isn't in it. */
export function toSimilarGame(match: SimilarMatch, found: SearchGame, hero: number): SimilarGame | null {
  const me = match.players.find((p) => p.hero === hero);
  if (!me) return null;
  return {
    match: match.match,
    won: me.radiant === match.radiantWon,
    startTime: found.startTime,
    duration: match.duration,
    sharedEnemies: found.sharedEnemies,
    sharedAllies: found.sharedAllies,
    position: me.position,
    lane: me.lane,
    kills: me.kills,
    deaths: me.deaths,
    assists: me.assists,
    networth: me.networth,
    lastHits10: me.lastHits10,
    buys: me.buys,
    deathsAt: me.deathsAt,
    allies: match.players.filter((p) => p.radiant === me.radiant).map(seat),
    enemies: match.players.filter((p) => p.radiant !== me.radiant).map(seat),
  };
}

/**
 * Walks the hero's most similar games: a stored game counts when he played `position` and his account has fewer
 * than GAMES_PER_ACCOUNT games picked; a game not stored yet goes to `missing`. Stops at ROLE_GOAL role games or
 * MAX_CANDIDATES games. `stored` has every match read so far, by id; null for one STRATZ could not give in full,
 * which is skipped and not fetched again.
 */
export function pickGames(search: HeroSearch, position: number, stored: Map<number, SimilarMatch | null>): HeroPick {
  const games: SimilarGame[] = [];
  const missing: number[] = [];
  const perAccount = new Map<number, number>();
  for (const found of search.games.slice(0, MAX_CANDIDATES)) {
    if (games.length >= ROLE_GOAL) break;
    const match = stored.get(found.match);
    if (match === undefined) {
      missing.push(found.match);
      continue;
    }
    if (match === null) continue;
    const me = match.players.find((p) => p.hero === search.hero);
    const game = toSimilarGame(match, found, search.hero);
    if (!me || !game || me.position !== position) continue;
    if (me.account !== null) {
      const n = perAccount.get(me.account) ?? 0;
      if (n >= GAMES_PER_ACCOUNT) continue;
      perAccount.set(me.account, n + 1);
    }
    games.push(game);
  }
  return { games, missing };
}
