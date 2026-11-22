/**
 * Similar Games: real high-rank games of one of our heroes against this draft's enemies (the similar-games
 * function finds them on OpenDota and reads them on STRATZ). From one hero's answer this builds what the Similar
 * Games answer on the Draft page shows: the record in the viewer's position, the record with each enemy in the
 * game, the build most of those games used, and the three closest games.
 *
 * Only games where the hero played the asked position count: the same hero in another role is another game.
 * Every number is a count of these games; nothing here says a choice causes a win.
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
  pending: boolean;
}

/** The fewest role games the answer needs; under it the hero gets no Similar Games answer. */
export const MIN_ROLE_GAMES = 10;
/** An item is in the usual build when at least this share of role games bought it. */
export const USUAL_SHARE = 0.5;
/** Items in the usual build, at most. */
export const USUAL_ITEMS = 6;
const CLOSEST_GAMES = 3;

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

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}
