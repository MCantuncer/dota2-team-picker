/**
 * Which spell levels a hero has at a hero level in lane, from the skill build high-rank players used
 * (Snapshot.skillBuilds, the same build the Skills card shows). Lane tactics read these so a kill line counts
 * only the spells the enemy really has at level 6.
 */
import { laneSpell } from "./lane-facts";
import type { HeroAbility, Position, Snapshot } from "./types";

/** Spell levels by ability key at one hero level. */
export type SpellLevels = Map<string, number>;

/** A hero's skill build for a position, else for the position with the most guide games; undefined without one. */
function buildLevels(data: Snapshot, heroId: number, position: Position): number[] | undefined {
  const slices = data.skillBuilds?.[String(heroId)];
  if (!slices) return undefined;
  const own = slices[String(position)]?.build;
  if (own) return own.levels;
  const best = Object.values(slices)
    .filter((s) => s?.build)
    .sort((a, b) => (b?.matches ?? 0) - (a?.matches ?? 0))[0];
  return best?.build?.levels;
}

/** Levels an even opening covers: the laning stage. */
const OPENING_LEVELS = 10;
const ULTIMATE_LEVEL = 6;

/**
 * An even opening for a hero whose guide players don't agree on a build: the basic spells in hotkey order,
 * one point each in turn, and the ultimate at 6. At level 6 every basic spell has one or two points, so a
 * number read from it is never above what a real build would have.
 */
function evenOpening(abilities: HeroAbility[]): number[] {
  const basics = abilities.filter((a) => !a.ultimate && a.slot <= 3).sort((a, b) => a.slot - b.slot);
  const ultimate = abilities.find((a) => a.ultimate);
  if (!basics.length) return [];
  let next = 0;
  return Array.from({ length: OPENING_LEVELS }, (_, i) => {
    if (i + 1 === ULTIMATE_LEVEL && ultimate) return ultimate.id;
    const basic = basics[next++ % basics.length];
    return basic ? basic.id : 0;
  });
}

/**
 * The spell levels a hero has at `level`, by ability key, from the high-rank build, else from an even
 * opening. Talents and empty levels are skipped. Undefined when the snapshot has no ability list for the hero.
 */
export function spellLevelsAt(data: Snapshot, heroId: number, position: Position, level: number): SpellLevels | undefined {
  const abilities = data.heroAbilities?.[String(heroId)]?.abilities;
  if (!abilities) return undefined;
  const levels = buildLevels(data, heroId, position) ?? evenOpening(abilities);
  const keyOf = new Map(abilities.map((a) => [a.id, a.key]));
  const out: SpellLevels = new Map();
  for (const id of levels.slice(0, level)) {
    const key = keyOf.get(id);
    if (key) out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}

/**
 * The level a spell's value is read at: its own level, or the level of the ability a field is levelled by
 * (an orb's level for a summon's health).
 */
export function levelFor(levels: SpellLevels, key: string, field?: "damage" | "summonHealth"): number {
  const from = field ? laneSpell(key)?.levelFrom?.[field] : undefined;
  return levels.get(from ?? key) ?? 0;
}

/**
 * The first hero level at which high-rank players take a spell, or undefined when they don't in lane or the
 * snapshot has no build for the hero (an even opening is a guess, never shown as what players do).
 */
export function firstLevelOf(data: Snapshot, heroId: number, position: Position, key: string, upTo = 10): number | undefined {
  const levels = buildLevels(data, heroId, position);
  const id = data.heroAbilities?.[String(heroId)]?.abilities.find((a) => a.key === key)?.id;
  if (!levels || id === undefined) return undefined;
  const at = levels.slice(0, upTo).indexOf(id);
  return at < 0 ? undefined : at + 1;
}
