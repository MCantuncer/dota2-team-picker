/**
 * Similar Games: real high-rank games of one of our heroes against this draft's enemies (the similar-games
 * function finds them on OpenDota and reads them on STRATZ). From one hero's answer this builds what the Similar
 * Games answer on the Draft page shows: the record in the viewer's position, the record with each enemy in the
 * game, the build most of those games used, and the three closest games.
 *
 * Only games where the hero played the asked position count: the same hero in another role is another game.
 * Every number is a count of these games; nothing here says a choice causes a win. What Won keeps only gaps a
 * one-sided Fisher exact test finds, corrected for every test tried, so chance gaps in a small sample never show.
 */
import type { ItemInfo, Position } from "./types";

export type SimilarLane = "safe" | "mid" | "off" | "jungle";

/** One hero of a similar game. */
export interface SimilarSeat {
  hero: number;
  position: Position | null;
  lane: SimilarLane | null;
}

/** One game of our hero, as the similar-games function answers it. */
export interface SimilarGame {
  match: number;
  won: boolean;
  /** Unix seconds. */
  startTime: number;
  /** Seconds. */
  duration: number;
  /** How many of our enemies were on the other team, and how many of our other heroes on his. */
  sharedEnemies: number;
  sharedAllies: number;
  position: Position | null;
  lane: SimilarLane | null;
  kills: number;
  deaths: number;
  assists: number;
  networth: number;
  lastHits10: number | null;
  /** His first buy of each item: [item id, seconds from the horn], in buy order. */
  buys: [number, number][];
  /** His deaths: [seconds from the horn, attacker hero id or null]. */
  deathsAt: [number, number | null][];
  /** His team, him included, and the other team. */
  allies: SimilarSeat[];
  enemies: SimilarSeat[];
}

/** One of our heroes in the similar-games answer. */
export interface SimilarHeroAnswer {
  hero: number;
  /** Shared enemies the games have at least: 3, or 2 when 3 gave too few games. Null: too few games at all. */
  level: 3 | 2 | null;
  /** Games found at the level, every role. */
  found: number;
  /** The games read so far, most similar first. */
  games: SimilarGame[];
  /** True while more games are still being read. */
  pending: boolean;
}

export interface SimilarInput {
  position: Position;
  enemies: number[];
  allies: number[];
  /** The enemy in his lane in this draft, when the lane is known; null when it is a guess. */
  laneEnemy: number | null;
  items: Record<string, ItemInfo>;
}

export interface UsualBuy {
  item: number;
  /** Median minute of the first buy, in the games that bought it. */
  minute: number;
  /** Role games that bought it. */
  games: number;
}

export interface SimilarSummary {
  hero: number;
  level: 3 | 2;
  /** Games found at the level, every role. */
  found: number;
  /** Games in the asked position, and how many he won. */
  games: number;
  wins: number;
  /** Each enemy of this draft: role games he was in, and how many our hero won. In draft order. */
  enemies: { hero: number; games: number; wins: number }[];
  /** Finished items most role games bought, by median minute. */
  usualBuild: UsualBuy[];
  /** The two closest wins and the closest loss (more of one when there are too few of the other). */
  closest: SimilarGame[];
  /** Tested targets, in game order; empty when none passed. Null while games are pending or under MIN_TARGET_GAMES. */
  whatWon: WonTarget[] | null;
  pending: boolean;
}

/** Wins among the games that met a target and the games that didn't. */
export interface TargetSide {
  games: number;
  wins: number;
}

/** A What Won target: "Starforge by 24" or "Die 2 times or less by 20". */
export type WonTarget =
  & { minute: number; met: TargetSide; missed: TargetSide; /** Bonferroni corrected one-sided p. */ p: number }
  & ({ kind: "item"; item: number } | { kind: "deaths"; most: number });

/** The fewest role games the answer needs; under it the hero gets no Similar Games answer. */
export const MIN_ROLE_GAMES = 10;
/** An item is in the usual build when at least this share of role games bought it. */
export const USUAL_SHARE = 0.5;
/** Items in the usual build, at most. */
export const USUAL_ITEMS = 6;
const CLOSEST_GAMES = 3;
/** What Won needs this many role games. */
export const MIN_TARGET_GAMES = 20;
/** Each side of a target (met, missed) needs this many games to be tested. */
export const MIN_SIDE = 6;
/** A target shows when its corrected p is under this. */
export const MAX_P = 0.05;
/** Deaths are counted up to this minute, in games that lasted past it. */
export const DEATHS_BY = 20;

/** The enemy lane that faces each of our lanes: their offlane is our safe lane. */
const FACING: Record<SimilarLane, SimilarLane> = { safe: "off", mid: "mid", off: "safe", jungle: "jungle" };

/** The summary for one of our heroes, or null when the answer has too few games in the asked position. */
export function similarSummary(answer: SimilarHeroAnswer, input: SimilarInput): SimilarSummary | null {
  if (answer.level === null) return null;
  const games = roleGames(answer, input.position);
  if (games.length < MIN_ROLE_GAMES) return null;
  return {
    hero: answer.hero,
    level: answer.level,
    found: answer.found,
    games: games.length,
    wins: games.filter((g) => g.won).length,
    enemies: input.enemies.map((hero) => {
      const with_ = games.filter((g) => g.enemies.some((s) => s.hero === hero));
      return { hero, games: with_.length, wins: with_.filter((g) => g.won).length };
    }),
    usualBuild: usualBuild(games, input.items),
    closest: closestGames(games, input.laneEnemy),
    whatWon: answer.pending || games.length < MIN_TARGET_GAMES ? null : whatWon(games, input.items),
    pending: answer.pending,
  };
}

/** The answer's games where the hero played the asked position. */
export function roleGames(answer: SimilarHeroAnswer, position: Position): SimilarGame[] {
  return answer.games.filter((g) => g.position === position);
}

/** A part built into a bigger item within this many seconds was a step, not a stop (Kaya into Meteor Hammer). */
export const STEP_SECONDS = 300;

/**
 * The finished items he bought in one game, each with the second of its first buy: items made from parts, minus
 * ones he built into a bigger item within STEP_SECONDS (Soul Booster into Octarine Core). An item he kept longer
 * counts (Meteor Hammer at 11 min, Starforge at 22).
 */
export function finishedBuys(game: SimilarGame, items: Record<string, ItemInfo>): [number, number][] {
  return game.buys.filter(([id, at]) => {
    if (!items[String(id)]?.components.length) return false;
    return !game.buys.some(([other, otherAt]) =>
      other !== id && otherAt >= at && otherAt - at < STEP_SECONDS &&
      (items[String(other)]?.components.includes(id) ?? false)
    );
  });
}

/** Finished items at least USUAL_SHARE of the games bought, by median first-buy minute. */
export function usualBuild(games: SimilarGame[], items: Record<string, ItemInfo>): UsualBuy[] {
  const seconds = new Map<number, number[]>();
  for (const g of games) {
    for (const [id, s] of finishedBuys(g, items)) seconds.set(id, [...(seconds.get(id) ?? []), s]);
  }
  return [...seconds]
    .filter(([, s]) => s.length >= games.length * USUAL_SHARE)
    .map(([item, s]) => ({ item, minute: Math.round(median(s) / 60), games: s.length }))
    .sort((a, b) => a.minute - b.minute || b.games - a.games)
    .slice(0, USUAL_ITEMS);
}

/**
 * How close a game is to this draft: 2 per shared enemy, 1 per shared ally, and 2 more when this draft's lane
 * enemy (only when known, not guessed) was in his lane in that game.
 */
export function closeness(game: SimilarGame, laneEnemy: number | null): number {
  const facing = game.lane ? FACING[game.lane] : null;
  const sameLane = laneEnemy !== null && facing !== null &&
    game.enemies.some((s) => s.hero === laneEnemy && s.lane === facing);
  return 2 * game.sharedEnemies + game.sharedAllies + (sameLane ? 2 : 0);
}

/** The two closest wins and the closest loss; when there are too few of one, more of the other. Ties: newest. */
export function closestGames(games: SimilarGame[], laneEnemy: number | null): SimilarGame[] {
  const ranked = [...games].sort((a, b) => closeness(b, laneEnemy) - closeness(a, laneEnemy) || b.match - a.match);
  const wins = ranked.filter((g) => g.won);
  const losses = ranked.filter((g) => !g.won);
  const winsPicked = wins.slice(0, CLOSEST_GAMES - Math.min(1, losses.length));
  return [...winsPicked, ...losses.slice(0, CLOSEST_GAMES - winsPicked.length)];
}

/**
 * The targets that split wins from losses in these games beyond chance. Item: for each finished item at least
 * MIN_SIDE games bought, T = the median minute wins bought it, rounded up; among games that lasted past T, wins with
 * it by T against wins without it. Deaths: d = the median deaths by DEATHS_BY in wins, rounded down; among games
 * that lasted past DEATHS_BY, wins with at most d deaths against wins with more. Each is a one-sided Fisher exact
 * test, Bonferroni corrected over every test tried; at most the best item and the deaths target show, by minute.
 */
export function whatWon(games: SimilarGame[], items: Record<string, ItemInfo>): WonTarget[] {
  const tests: WonTarget[] = [];
  const bought = games.map((g) => new Map(finishedBuys(g, items)));
  const buyers = new Map<number, number>();
  const winBuys = new Map<number, number[]>();
  games.forEach((g, i) => {
    bought[i]!.forEach((at, id) => {
      buyers.set(id, (buyers.get(id) ?? 0) + 1);
      if (g.won) winBuys.set(id, [...(winBuys.get(id) ?? []), at]);
    });
  });
  for (const [item, seconds] of winBuys) {
    if ((buyers.get(item) ?? 0) < MIN_SIDE) continue;
    const minute = Math.ceil(median(seconds) / 60);
    const split = sides(games, (g, i) => {
      if (g.duration <= minute * 60) return undefined;
      const at = bought[i]!.get(item);
      return at !== undefined && at <= minute * 60;
    });
    if (split) tests.push({ kind: "item", item, minute, ...split });
  }
  const deathsBy = (g: SimilarGame) => g.deathsAt.filter(([at]) => at <= DEATHS_BY * 60).length;
  const lasted = games.filter((g) => g.duration > DEATHS_BY * 60);
  const winDeaths = lasted.filter((g) => g.won).map(deathsBy);
  if (winDeaths.length > 0) {
    const most = Math.floor(median(winDeaths));
    const split = sides(games, (g) => (g.duration > DEATHS_BY * 60 ? deathsBy(g) <= most : undefined));
    if (split) tests.push({ kind: "deaths", most, minute: DEATHS_BY, ...split });
  }
  const passed = tests
    .map((t) => ({ ...t, p: Math.min(1, t.p * tests.length) }))
    .filter((t) => t.p < MAX_P)
    .sort((a, b) => a.p - b.p || b.met.games + b.missed.games - (a.met.games + a.missed.games));
  const item = passed.find((t) => t.kind === "item");
  const deaths = passed.find((t) => t.kind === "deaths");
  return [item, deaths].filter((t) => t !== undefined).sort((a, b) => a.minute - b.minute);
}

/** Splits games by a target (undefined: the game doesn't count) and tests it; null when a side is too small. */
function sides(
  games: SimilarGame[],
  met: (g: SimilarGame, i: number) => boolean | undefined,
): { met: TargetSide; missed: TargetSide; p: number } | null {
  const a = { games: 0, wins: 0 };
  const b = { games: 0, wins: 0 };
  games.forEach((g, i) => {
    const m = met(g, i);
    if (m === undefined) return;
    const side = m ? a : b;
    side.games++;
    if (g.won) side.wins++;
  });
  if (a.games < MIN_SIDE || b.games < MIN_SIDE) return null;
  return { met: a, missed: b, p: fisherGreater(a.wins, a.games, a.wins + b.wins, a.games + b.games) };
}

/**
 * One-sided Fisher exact test: the chance that a group of `n` games drawn from `total` games with `wins` wins has
 * `hits` or more wins.
 */
export function fisherGreater(hits: number, n: number, wins: number, total: number): number {
  const logChoose = (a: number, b: number) => logFactorial(a) - logFactorial(b) - logFactorial(a - b);
  const denominator = logChoose(total, n);
  let p = 0;
  for (let x = hits; x <= Math.min(n, wins); x++) {
    if (n - x > total - wins) continue;
    p += Math.exp(logChoose(wins, x) + logChoose(total - wins, n - x) - denominator);
  }
  return Math.min(1, p);
}

function logFactorial(n: number): number {
  let sum = 0;
  for (let i = 2; i <= n; i++) sum += Math.log(i);
  return sum;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}
