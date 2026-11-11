/**
 * What one hero's high-rank players do with each item, from the matchup cache: the checks Can asked for on
 * Slark's Soul Ring (2026-11-11), run the same way for every hero and position. For each item bought in at
 * least CANDIDATE_SHARE of the games:
 * - how often, and at what minute;
 * - wins against losses, counting purchases by the usual minute plus HORIZON in games still running then,
 *   so longer games (more gold, more items) don't fake a gap;
 * - for lane items, the team's networth lead when it is bought, against the lead at the same minute in games without it
 *   (Soul Ring is bought from behind: a lane fix, not a default);
 * - which other items come sooner or later in games with it (descriptive, no test);
 * - enemies it is bought against more or less often than in the hero's other games;
 * - the older half of the cached games against the newer half.
 * The win, enemy and trend checks count purchases by the same cutoff in games still running then, and each
 * flag needs MIN_SIDE games a side and a two-proportion z score past Z_FLAG. With hundreds of enemy checks
 * per hero some flags are chance: each pattern counts the checks it ran, so the report can say how many. These are counts, not odds: the report tells Can and the engine what to check, and
 * nothing here changes a build.
 */
import { HORIZON, type PooledGame, type Share, share, usualMinute } from "./item-problems";

/** An item is checked when the hero buys it in at least this share of its games. */
export const CANDIDATE_SHARE = 0.1;
/** A gap is flagged only past this z score (about 1 in 370 by chance on each check, CHANCE). */
export const Z_FLAG = 3;
/** The two-sided chance of passing Z_FLAG with no real gap. */
export const CHANCE = 0.0027;
/** A side of a comparison needs this many games. */
export const MIN_SIDE = 10;
/** The lead is compared only for items usually bought by this minute: later, the lead mostly says who is winning. */
export const LANE_MINUTES = 15;
/** Another item's minute counts as moved when its median shifts by at least this many minutes... */
export const MIN_SHIFT = 2;
/** ...over at least this many games on each side. Descriptive only: no test stands behind it. */
export const MIN_MOVED_SIDE = 20;

/** The normal approximation behind zScore needs this many expected games of the rarer outcome on the smaller side. */
export const MIN_EXPECTED = 5;

/**
 * Two-proportion z score of a against b, or undefined when it can't be read: a side under MIN_SIDE games,
 * or an item nearly everyone (or nearly no one) buys, where one game more or less swings the score (Power
 * Treads in 182 of 183 games).
 */
export function zScore(a: Share, b: Share): number | undefined {
  if (a.games < MIN_SIDE || b.games < MIN_SIDE) return undefined;
  const pooled = (a.bought + b.bought) / (a.games + b.games);
  if (Math.min(pooled, 1 - pooled) * Math.min(a.games, b.games) < MIN_EXPECTED) return undefined;
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / a.games + 1 / b.games));
  return se ? (share(a) - share(b)) / se : undefined;
}

const flagged = (z: number | undefined) => z !== undefined && Math.abs(z) >= Z_FLAG;

const median = (xs: number[]): number | undefined => {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
};

/** Another item whose median minute differs in games with the checked item. */
export interface Moved {
  item: number;
  /** Median minute in games with the checked item, and without it. */
  with: number;
  without: number;
}

/** An enemy the checked item is bought against more (z above 0) or less often than in the other games. */
export interface EnemyGap {
  enemy: number;
  /** Games against this enemy that bought the item by the cutoff, and the hero's other games. */
  against: Share;
  others: Share;
  z: number;
}

/** Everything the report says about one item of one hero and position. */
export interface ItemPattern {
  item: number;
  /** Games that bought it at any time. */
  all: Share;
  /** Median minute of the first purchase. */
  minute: number;
  /** Bought by minute + HORIZON, in games still running then; the enemy and trend checks use the same. */
  wins: Share;
  losses: Share;
  /** Undefined when the check couldn't run (zScore). */
  winZ?: number;
  /** Median team networth lead at the purchase minute, and at the usual minute in games without it; lane items only. */
  leadWith?: number;
  leadWithout?: number;
  moved: Moved[];
  /** Enemies past Z_FLAG, biggest gap first. */
  enemies: EnemyGap[];
  /** Older and newer half of the games, by match id. */
  older: Share;
  newer: Share;
  trendZ?: number;
  /** The z checks that could run (wins, trend, one per enemy), for the count of flags chance alone gives. */
  tests: number;
}

const count = (games: PooledGame[], item: number, by = Infinity): Share => ({
  bought: games.filter(({ bought }) => {
    const at = bought.get(item);
    return at !== undefined && at <= by;
  }).length,
  games: games.length,
});

/** The lead of a game at a minute, when the game has one there. */
const leadAt = (g: PooledGame, minute: number) => g.game.lead[Math.floor(minute)];

/** The patterns of every item one hero and position buys often enough; `games` are pooled (poolByMatch). */
export function itemPatterns(games: PooledGame[]): ItemPattern[] {
  const counts = new Map<number, number>();
  for (const g of games) for (const id of g.bought.keys()) counts.set(id, (counts.get(id) ?? 0) + 1);
  const candidates = [...counts].filter(([, n]) => n >= games.length * CANDIDATE_SHARE).map(([id]) => id);
  const enemies = [...new Set(games.flatMap((g) => g.enemies))];

  return candidates.flatMap((item): ItemPattern[] => {
    const minute = usualMinute(games, item);
    if (minute === undefined) return [];
    const by = (minute + HORIZON) * 60;
    // Every check below counts purchases by `by` in games still running then, so longer games don't fake a gap.
    const running = games.filter((g) => g.game.duration >= by);
    const wins = count(running.filter((g) => g.game.won), item, by);
    const losses = count(running.filter((g) => !g.game.won), item, by);
    const withIt = games.filter((g) => g.bought.has(item));
    const without = games.filter((g) => !g.bought.has(item));

    const lane = minute <= LANE_MINUTES;
    const leadWith = !lane ? undefined : median(withIt.flatMap((g) => {
      const lead = leadAt(g, (g.bought.get(item) ?? 0) / 60);
      return lead === undefined ? [] : [lead];
    }));
    const leadWithout = !lane ? undefined : median(without.flatMap((g) => {
      const lead = leadAt(g, minute);
      return lead === undefined ? [] : [lead];
    }));

    const moved = candidates.flatMap((other): Moved[] => {
      if (other === item) return [];
      const otherMinute = usualMinute(games, other);
      if (otherMinute === undefined) return [];
      // Only games long enough to have bought the other item at its usual time and a little after.
      const cut = (otherMinute + HORIZON) * 60;
      const at = (list: PooledGame[]) => list.flatMap((g) => {
        const t = g.bought.get(other);
        return g.game.duration < cut || t === undefined || t > cut ? [] : [t / 60];
      });
      const a = at(withIt);
      const b = at(without);
      if (a.length < MIN_MOVED_SIDE || b.length < MIN_MOVED_SIDE) return [];
      const w = median(a) ?? 0;
      const wo = median(b) ?? 0;
      return Math.abs(w - wo) >= MIN_SHIFT ? [{ item: other, with: w, without: wo }] : [];
    });

    const winZ = zScore(wins, losses);
    const byMatch = [...running].sort((a, b) => a.game.match - b.game.match);
    const half = Math.floor(byMatch.length / 2);
    const older = count(byMatch.slice(0, half), item, by);
    const newer = count(byMatch.slice(half), item, by);
    const trendZ = zScore(newer, older);
    let tests = (winZ === undefined ? 0 : 1) + (trendZ === undefined ? 0 : 1);
    const gaps = enemies.flatMap((enemy): EnemyGap[] => {
      const against = count(running.filter((g) => g.enemies.includes(enemy)), item, by);
      const others = count(running.filter((g) => !g.enemies.includes(enemy)), item, by);
      const z = zScore(against, others);
      if (z === undefined) return [];
      tests++;
      return flagged(z) ? [{ enemy, against, others, z }] : [];
    }).sort((x, y) => Math.abs(y.z) - Math.abs(x.z));

    return [{
      item,
      all: count(games, item),
      minute,
      wins,
      losses,
      winZ,
      leadWith,
      leadWithout,
      moved,
      enemies: gaps,
      older,
      newer,
      trendZ,
      tests,
    }];
  });
}

/** How many flags a pattern carries: wins against losses, trend, and each enemy. */
export function flagCount(p: ItemPattern): number {
  return (flagged(p.winZ) ? 1 : 0) + (flagged(p.trendZ) ? 1 : 0) + p.enemies.length;
}
