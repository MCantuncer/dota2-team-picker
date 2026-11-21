/**
 * The game numbers lane tactics are worked out from: each hero's base stats and the lane-relevant numbers of
 * each spell (damage, cooldown, mana, reach, width, delay, heal, aura, summon health). They are generated from
 * OpenDota's game constants into data-lane-facts.ts (`npm run lane-facts`) so a patch shows up as a reviewed
 * diff, and read here with the patch's attribute rules to give a hero's stats at a level.
 */
import { LANE_FACTS } from "./data-lane-facts";

/** A hero's base numbers before levels and items, from the game files. */
export interface LaneHero {
  /** Dota's internal hero name without the `npc_dota_hero_` prefix, like `necrolyte`. */
  name: string;
  primary: "str" | "agi" | "int" | "all";
  baseHealth: number;
  baseMana: number;
  baseArmor: number;
  /** Base magic resistance in percent (25 for every hero today). */
  baseMagicResist: number;
  attackMin: number;
  attackMax: number;
  attackRange: number;
  /** Base attack time in seconds. */
  attackRate: number;
  moveSpeed: number;
  str: [base: number, gain: number];
  agi: [base: number, gain: number];
  int: [base: number, gain: number];
  /** The hero's spells that matter in lane, by key, in the game's ability order. */
  spells: string[];
}

/** How a spell's damage is reduced: by magic resistance, by armor, or not at all. */
export type DamageType = "magical" | "physical" | "pure";

/**
 * One spell's lane numbers. Lists hold one value per spell level; a single value applies at every level.
 * Undefined means the constants don't give it, never zero.
 */
export interface LaneSpell {
  key: string;
  name: string;
  /** Passive spells never need a cast, a cooldown or mana. */
  passive?: true;
  /** How a cast picks its target: a point on the ground, a unit, or none (around the caster). Unset for passives. */
  cast?: "point" | "unit" | "none";
  /** Damage of one cast on one hero, before resistances; damage over time counts up to LANE_DOT_SECONDS. */
  damage?: number[];
  damageType?: DamageType;
  cooldown?: number[];
  mana?: number[];
  castRange?: number[];
  /** Seconds from the start of the cast to its release (cast animation). */
  castPoint?: number;
  /** Seconds between the release and the effect landing, for spells you can walk out of. */
  delay?: number;
  /** Radius of the area the spell hits around its target point or caster. */
  radius?: number[];
  /** Width of a line spell; the widest point when it changes along the way. */
  width?: number;
  /** How far a line spell travels. */
  length?: number;
  stun?: number[];
  /** Health the caster gets back from one cast. */
  heal?: number[];
  /** A damaging aura: its reach and the share of max health it takes each second, in percent. */
  aura?: { radius: number; healthPerSecondPct: number[] };
  /** A summoned unit's health. */
  summonHealth?: number[];
  /**
   * Values levelled by another of the hero's abilities instead of this one (an orb, for example), by field
   * name: `{ summonHealth: "invoker_quas" }`.
   */
  levelFrom?: Partial<Record<"damage" | "summonHealth", string>>;
  /** Whether the spell hits creeps and summons as well as heroes. */
  hitsUnits: boolean;
}

/** All lane facts: heroes by hero id, spells by key. */
export interface LaneFacts {
  heroes: Record<string, LaneHero>;
  spells: Record<string, LaneSpell>;
}

/** Seconds of a damage-over-time spell counted as its lane damage: about one trade. */
export const LANE_DOT_SECONDS = 4;

/**
 * How attributes turn into stats on the current patch (7.42 general notes: base health 200, 20 health per
 * strength, 0.125% magic resistance per intelligence). Base health is in the hero numbers; the rest is here.
 */
export const ATTRIBUTE_RULES = {
  healthPerStrength: 20,
  manaPerIntelligence: 12,
  armorPerAgility: 1 / 6,
  magicResistPerIntelligencePct: 0.125,
  /** Attack damage per point of every attribute for universal heroes. */
  universalDamagePerAttribute: 0.45,
  /** Base attack speed every hero starts with, plus one per point of agility. */
  baseAttackSpeed: 100,
} as const;

/** A hero's stats at a level, before items, talents and buffs. */
export interface HeroStats {
  level: number;
  health: number;
  mana: number;
  armor: number;
  /** Total magic resistance in percent. */
  magicResist: number;
  /** Average attack damage of one hit. */
  attackDamage: number;
  attackRange: number;
  moveSpeed: number;
  /** Seconds between attacks. */
  attackInterval: number;
}

/**
 * A hero's stats at a level. `bonus` adds attribute points that come from spells (an orb's strength, for
 * example). Magic resistance from intelligence stacks with the base like any other source, multiplicatively.
 */
export function heroStatsAt(hero: LaneHero, level: number, bonus: Partial<Record<"str" | "agi" | "int", number>> = {}): HeroStats {
  const grown = (a: "str" | "agi" | "int") => hero[a][0] + hero[a][1] * (level - 1) + (bonus[a] ?? 0);
  const str = grown("str");
  const agi = grown("agi");
  const int = grown("int");
  const rules = ATTRIBUTE_RULES;
  const primary = hero.primary === "all" ? (str + agi + int) * rules.universalDamagePerAttribute : { str, agi, int }[hero.primary];
  const intResist = (int * rules.magicResistPerIntelligencePct) / 100;
  return {
    level,
    health: hero.baseHealth + str * rules.healthPerStrength,
    mana: hero.baseMana + int * rules.manaPerIntelligence,
    armor: hero.baseArmor + agi * rules.armorPerAgility,
    magicResist: 100 * (1 - (1 - hero.baseMagicResist / 100) * (1 - intResist)),
    attackDamage: (hero.attackMin + hero.attackMax) / 2 + primary,
    attackRange: hero.attackRange,
    moveSpeed: hero.moveSpeed,
    attackInterval: hero.attackRate / ((rules.baseAttackSpeed + agi) / 100),
  };
}

/** Share of physical damage that gets through this much armor (Dota's armor formula). */
export function armorMultiplier(armor: number): number {
  return 1 - (0.06 * armor) / (1 + 0.06 * Math.abs(armor));
}

/** Damage a hero with these stats takes from `amount` of this damage type. */
export function damageTaken(amount: number, type: DamageType, target: HeroStats): number {
  if (type === "pure") return amount;
  if (type === "physical") return amount * armorMultiplier(target.armor);
  return amount * (1 - target.magicResist / 100);
}

/** A spell value at a spell level (1 based), the last value past the end of the list; undefined at level 0. */
export function atLevel(values: readonly number[] | undefined, level: number): number | undefined {
  if (!values?.length || level < 1) return undefined;
  return values[Math.min(level, values.length) - 1];
}

/** The lane facts of a hero by id, or undefined for a hero the facts don't have. */
export function laneHero(heroId: number): LaneHero | undefined {
  return LANE_FACTS.heroes[String(heroId)];
}

/** The lane facts of a spell by key. */
export function laneSpell(key: string): LaneSpell | undefined {
  return LANE_FACTS.spells[key];
}
