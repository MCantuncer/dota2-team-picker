/**
 * Turns a STRATZ guide player's skill points, given in order without hero levels, into the ability
 * taken at each hero level, and learns which abilities the hero really has from the games.
 */
import type { HeroAbilities, Position } from "../engine/types";

/** Builds are compared and shown up to this level; talents are placed from the full games. */
export const BUILD_LEVELS = 18;
/** A game must reach this many skill points for its build to count. */
const MIN_POINTS = 16;
/** Hero levels that give no skill point (patch 7.3x and later): 17, 19 and 21 to 24. */
export const NO_POINT_LEVELS = new Set([17, 19, 21, 22, 23, 24]);

/** One guide player on the hero. */
export interface GuidePlayer {
  gameVersionId: number;
  position: Position | null;
  /** The hero level the player ended the game at. */
  level: number;
  /** Whether the player's team won, or null when STRATZ doesn't say. */
  won: boolean | null;
  /** Skill points in the order they were taken: ability, talent or attribute bonus ids. */
  points: number[];
}

/** An unknown max level is taken from the games only when at least this many put points in the ability. */
const MIN_GAMES_FOR_MAX_LEVEL = 3;

/**
 * The hero with only the abilities the guide players put points in, and each unknown max level (STRATZ
 * leaves many out) set to the most points any of them put in it, once MIN_GAMES_FOR_MAX_LEVEL games did.
 */
export function learnedHero(hero: HeroAbilities, players: GuidePlayer[]): HeroAbilities {
  const most = new Map<number, number>();
  const games = new Map<number, number>();
  for (const p of players) {
    const counts = new Map<number, number>();
    for (const id of p.points) counts.set(id, (counts.get(id) ?? 0) + 1);
    for (const [id, n] of counts) {
      most.set(id, Math.max(most.get(id) ?? 0, n));
      games.set(id, (games.get(id) ?? 0) + 1);
    }
  }
  return {
    ...hero,
    abilities: hero.abilities.flatMap((a) => {
      const seen = most.get(a.id);
      if (seen === undefined) return [];
      if (a.maxLevel > 0 || (games.get(a.id) ?? 0) < MIN_GAMES_FOR_MAX_LEVEL) return [a];
      return [{ ...a, maxLevel: seen }];
    }),
  };
}

/** The hero level of each of `count` skill points, for a hero that gets no point at NO_POINT_LEVELS. */
function pointLevels(count: number): number[] {
  const levels: number[] = [];
  for (let level = 1; levels.length < count; level++) if (!NO_POINT_LEVELS.has(level)) levels.push(level);
  return levels;
}

/** How many skill points a hero has by `level`: one per level, or none at NO_POINT_LEVELS. */
function pointsBy(level: number, everyLevel: boolean): number {
  if (everyLevel) return level;
  let n = 0;
  for (let l = 1; l <= level; l++) if (!NO_POINT_LEVELS.has(l)) n++;
  return n;
}

/**
 * Whether the hero gets a skill point every level (Invoker) rather than none at 17, 19 and 21 to 24:
 * true when more of the games past level 17 spent exactly one point per level than exactly the
 * skip-rule count.
 */
export function getsPointEveryLevel(players: Pick<GuidePlayer, "points" | "level">[]): boolean {
  let every = 0;
  let skip = 0;
  for (const p of players) {
    if (p.level < 18) continue;
    // Only games that match one rule exactly; a game one point short could be either.
    if (p.points.length === pointsBy(p.level, true)) every++;
    else if (p.points.length === pointsBy(p.level, false)) skip++;
  }
  return every > skip;
}

/**
 * A guide player's skill points as the id taken at each hero level (index 0 is level 1, 0 for a level
 * with no point), or null when they don't make a full build.
 *
 * STRATZ gives the points in order but not the hero level of each, so the k-th point is placed at the
 * k-th level that gives one. That holds when the player spent their points as they came: their point
 * count must match their final level, or be one short (a point not spent when the game ended); any
 * other count means points were held at the end and the levels can't be placed, so the game is dropped.
 * A point held mid-game and spent later still matches, and shifts the levels in between by one; the
 * typical build and the check against STRATZ's totals keep such a game from being shown, but a single
 * game's levels are not exact. Only the
 * first BUILD_LEVELS levels must be the hero's abilities, talents or attribute bonus; an unknown id
 * there (STRATZ sometimes answers 0) or an ability past its max drops the game too.
 */
export function toSequence(
  player: Pick<GuidePlayer, "points" | "level">,
  hero: HeroAbilities,
  everyLevel = false,
): number[] | null {
  const { points } = player;
  if (points.length < MIN_POINTS) return null;
  const expected = pointsBy(player.level, everyLevel);
  if (points.length !== expected && points.length !== expected - 1) return null;
  const levelOf = everyLevel ? points.map((_, i) => i + 1) : pointLevels(points.length);
  const maxLevel = new Map(hero.abilities.map((a) => [a.id, a.maxLevel]));
  const known = new Set([...maxLevel.keys(), ...hero.talents.flat().map((t) => t.id)]);
  const levels: number[] = [];
  const taken = new Map<number, number>();
  for (const [i, id] of points.entries()) {
    const level = levelOf[i] ?? 0;
    if (level <= BUILD_LEVELS && !known.has(id)) return null;
    const count = (taken.get(id) ?? 0) + 1;
    const max = maxLevel.get(id) ?? 0;
    if (max > 0 && count > max) return null;
    taken.set(id, count);
    levels[level - 1] = id;
  }
  return Array.from(levels, (id) => id ?? 0);
}
