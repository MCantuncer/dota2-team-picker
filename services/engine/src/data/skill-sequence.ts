/**
 * Turns a STRATZ guide player's skill points, given in order without hero levels, into the ability
 * taken at each hero level, and learns which abilities the hero really has from the games.
 */
import { TALENT_LEVELS, type HeroAbilities, type Position } from "../engine/types";

/** Builds are compared and shown up to this level; talents are placed from the full games. */
export const BUILD_LEVELS = 18;
/** A game must reach this many skill points for its build to count. */
const MIN_POINTS = 16;
/** Hero levels that give no skill point (patch 7.3x and later): 17, 19 and 21 to 24. */
export const NO_POINT_LEVELS = new Set([17, 19, 21, 22, 23, 24]);

/** One guide player on the hero. */
export interface GuidePlayer {
  /** When the game started, in Unix seconds: games from before the patch started don't count. */
  start: number;
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

/** Hero levels each rank of an ultimate can be learned at: 6, 12 and 18, Meepo's at 3, 10, 17 and 24 (7.41). */
const ULT_LEVELS = [6, 12, 18];
const ULT_LEVELS_BY_KEY: Record<string, number[]> = { meepo_divided_we_stand: [3, 10, 17, 24] };

/** A guide player's skill points placed on hero levels: an ability per level, and the level each talent was taken. */
export interface PlacedPoints {
  /** The ability taken at each hero level (index 0 is level 1, 0 for a level with nothing taken). */
  levels: number[];
  /** Each talent taken by the end of the game, with the level it is placed at. */
  talents: { id: number; level: number }[];
}

/**
 * A guide player's skill points placed on hero levels, or null when they don't make a full build.
 *
 * STRATZ gives the points in order but not the hero level of each. A talent doesn't use the level's skill point
 * (7.4x): at level 10 a player takes an ability and the talent, so the talent goes beside the ability before it, at
 * its tier's level or later, and takes no level of its own. Each ability point goes at the next level that gives one,
 * or the level its ultimate rank opens at when the player had to hold it (Sven's third God's Strength at 18 once
 * everything else is maxed). A point held mid-game and spent later shifts the levels in between by one; the typical
 * build and the check against STRATZ's totals keep such a game from being shown, but a single game's levels are not
 * exact. Only the first BUILD_LEVELS levels must be the hero's abilities, talents or attribute bonus; an unknown id
 * there (STRATZ sometimes answers 0), an ability past its max or a point past the game's last level drops the game.
 *
 * A hero with a point every level (Invoker) keeps one point per level, talents included, as before.
 */
export function toSequence(
  player: Pick<GuidePlayer, "points" | "level">,
  hero: HeroAbilities,
  everyLevel = false,
): PlacedPoints | null {
  const { points } = player;
  if (points.length < MIN_POINTS) return null;
  if (everyLevel) return everyLevelSequence(player, hero);
  const maxLevel = new Map(hero.abilities.map((a) => [a.id, a.maxLevel]));
  const ultLevels = new Map(
    hero.abilities.filter((a) => a.ultimate).map((a) => [a.id, ULT_LEVELS_BY_KEY[a.key] ?? ULT_LEVELS]),
  );
  const tierOf = new Map(hero.talents.flatMap((pair, tier) => pair.map((t) => [t.id, tier] as const)));
  const levels: number[] = [];
  const talents: PlacedPoints["talents"] = [];
  const taken = new Map<number, number>();
  let level = 0;
  for (const id of points) {
    const tier = tierOf.get(id);
    if (tier !== undefined) {
      const at = Math.max(level, TALENT_LEVELS[tier] ?? 0);
      if (at > player.level) return null;
      talents.push({ id, level: at });
      continue;
    }
    const count = (taken.get(id) ?? 0) + 1;
    const max = maxLevel.get(id) ?? 0;
    if (max > 0 && count > max) return null;
    taken.set(id, count);
    level = nextPointLevel(Math.max(level + 1, ultLevels.get(id)?.[count - 1] ?? 0));
    if (level <= BUILD_LEVELS && !maxLevel.has(id)) return null;
    if (level > player.level) return null;
    levels[level - 1] = id;
  }
  return { levels: Array.from(levels.slice(0, BUILD_LEVELS), (id) => id ?? 0), talents };
}

/** The first level from `level` on that gives a skill point. */
function nextPointLevel(level: number): number {
  let at = level;
  while (NO_POINT_LEVELS.has(at)) at++;
  return at;
}

/**
 * A hero with a point every level (Invoker): the k-th point at level k, talents included. The point count must match
 * the final level, or be one short (a point not spent when the game ended).
 */
function everyLevelSequence(player: Pick<GuidePlayer, "points" | "level">, hero: HeroAbilities): PlacedPoints | null {
  const { points } = player;
  if (points.length !== player.level && points.length !== player.level - 1) return null;
  const maxLevel = new Map(hero.abilities.map((a) => [a.id, a.maxLevel]));
  const talentIds = new Set(hero.talents.flat().map((t) => t.id));
  const levels: number[] = [];
  const talents: PlacedPoints["talents"] = [];
  const taken = new Map<number, number>();
  for (const [i, id] of points.entries()) {
    const level = i + 1;
    if (level <= BUILD_LEVELS && !maxLevel.has(id) && !talentIds.has(id)) return null;
    const count = (taken.get(id) ?? 0) + 1;
    const max = maxLevel.get(id) ?? 0;
    if (max > 0 && count > max) return null;
    taken.set(id, count);
    if (talentIds.has(id)) talents.push({ id, level });
    levels[i] = id;
  }
  return { levels: Array.from(levels.slice(0, BUILD_LEVELS), (id) => id ?? 0), talents };
}
