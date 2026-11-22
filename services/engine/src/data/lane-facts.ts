/**
 * Builds the lane facts (src/engine/lane-facts.ts) from OpenDota's game constants: hero base stats and each
 * spell's lane numbers. OpenDota names a spell's numbers freely (`dragon_slave_damage`, `shock_width`), so a
 * number is read by the label the game shows for it ("DAMAGE:", "RADIUS:") or by a key ending, never by a
 * spell's name. The output is written to a committed file (scripts/lane-facts.ts) and reviewed as a diff.
 */
import { LANE_DOT_SECONDS, type DamageType, type LaneFacts, type LaneHero, type LaneSpell } from "../engine/lane-facts";
import { getOpenDota } from "./opendota";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** One labelled number of a spell, as OpenDota lists it. */
interface Attrib {
  key: string;
  /** The in-game label, upper case without the colon, like "DAMAGE" or "HEALTH (QUAS)". */
  label: string;
  values: number[];
  isPercent: boolean;
}

/** Numbers of a value that is a number, a string ("90", "75%") or a list of them; empty when any is not a number. */
export function toNumbers(value: unknown): { values: number[]; isPercent: boolean } {
  const list = Array.isArray(value) ? value : [value];
  const values: number[] = [];
  let isPercent = false;
  for (const v of list) {
    const text = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : "";
    if (text.endsWith("%")) isPercent = true;
    const n = Number(text.replace(/%$/, ""));
    if (text === "" || !Number.isFinite(n)) return { values: [], isPercent: false };
    values.push(n);
  }
  return { values, isPercent };
}

function attribs(raw: Record<string, unknown>): Attrib[] {
  if (!Array.isArray(raw.attrib)) return [];
  return raw.attrib.flatMap((a): Attrib[] => {
    if (!isRecord(a) || typeof a.key !== "string") return [];
    const header = typeof a.header === "string" ? a.header : "";
    const label = header.replace(/\\n/g, " ").replace(/:/g, "").trim().toUpperCase();
    const { values, isPercent } = toNumbers(a.value);
    return values.length ? [{ key: a.key, label, values, isPercent }] : [];
  });
}

/** The label without an orb or source tag: "DAMAGE (EXORT)" reads as "DAMAGE". */
const bareLabel = (label: string) => label.replace(/\s*\(.*\)$/, "");
/** The tag in a label, like "EXORT" in "DAMAGE (EXORT)". */
const labelTag = (label: string) => /\(([^)]+)\)$/.exec(label)?.[1];

/** Below this a "health" counts hits (wards and traps with pip health), not health points. */
const MIN_SUMMON_HEALTH = 50;

/** Labels that mean the damage of one hit of the spell, read before any other damage label. */
/**
 * Labels of one hit on a hero. "VOID MARK DAMAGE" is Astral Step's hit; "DAMAGE PER GLOB" is one of Mortimer Kisses'
 * globs, the least a hero takes from it.
 */
const HIT_DAMAGE_LABELS = new Set(["DAMAGE", "IMPACT DAMAGE", "INITIAL DAMAGE", "EXPLOSION DAMAGE", "DAMAGE EACH BOUNCE", "DAMAGE/HEAL", "HEAL/DAMAGE", "VOID MARK DAMAGE", "DAMAGE PER GLOB"]);
/** Labels of a spell that damages an enemy and heals an ally; with a plain duration they are per second. */
const HEAL_OR_DAMAGE = new Set(["DAMAGE/HEAL", "HEAL/DAMAGE"]);
/**
 * A spell's own name for its hit: "BEAM DAMAGE", "STRIKE DAMAGE", "QUILL BASE DAMAGE". One word before DAMAGE
 * (and an optional BASE), unless the word says the number is something else than one hit on a hero.
 */
const NAMED_DAMAGE = /^(?:([A-Z]+) )?(?:BASE )?DAMAGE$/;
const NOT_A_HIT = new Set([
  "BONUS", "CRITICAL", "ATTACK", "ILLUSION", "OUTGOING", "INCOMING", "CLEAVE", "SPLASH", "WARD", "BUILDING", "HEALTH",
  "MAX", "MIN", "MAXIMUM", "MINIMUM", "BURN", "INCREASED", "TOTAL", "PROC", "SPELL", "MOVE", "CURRENT", "SELF", "CREEP",
  "INCREMENTAL", "ADDED", "EXTRA", "ALL", "ROCKET", "CORROSIVE",
]);
const isNamedHit = (label: string) => {
  const match = NAMED_DAMAGE.exec(label);
  return !!match && !NOT_A_HIT.has(match[1] ?? "");
};
/** Pairs of labels whose average is one hit: a spell that rolls its damage between two numbers. */
const DAMAGE_RANGES: [string, string][] = [
  ["MINIMUM DAMAGE", "MAXIMUM DAMAGE"],
  ["MIN DAMAGE", "MAX DAMAGE"],
  ["DAMAGE MIN", "DAMAGE MAX"],
];
const DOT_LABELS = new Set(["DAMAGE PER SECOND", "BURN DAMAGE PER SECOND", "BASE DAMAGE PER SECOND", "DAMAGE/HEAL PER SECOND"]);
const DAMAGE_TYPES: Record<string, DamageType> = { Magical: "magical", Physical: "physical", Pure: "pure" };

const positive = (values: number[]) => values.some((v) => v > 0);
const first = (list: Attrib[], test: (a: Attrib) => boolean) => list.find((a) => test(a) && !a.isPercent && positive(a.values));

/** Adds two per-level lists, the shorter one holding its last value. */
function addLevels(a: number[], b: number[]): number[] {
  return Array.from({ length: Math.max(a.length, b.length) }, (_, i) => (a[Math.min(i, a.length - 1)] ?? 0) + (b[Math.min(i, b.length - 1)] ?? 0));
}

/** The average of a spell that rolls its damage between a minimum and a maximum. */
function rolledDamage(list: Attrib[]): Attrib | undefined {
  for (const [low, high] of DAMAGE_RANGES) {
    const min = first(list, (a) => bareLabel(a.label) === low);
    const max = first(list, (a) => bareLabel(a.label) === high);
    if (min && max) return { ...min, values: addLevels(min.values, max.values).map((v) => v / 2) };
  }
  return undefined;
}

function damageOf(raw: Record<string, unknown>, list: Attrib[]): { values: number[]; tag?: string } | undefined {
  const direct = toNumbers(raw.dmg);
  const named = positive(direct.values)
    ? { values: direct.values, label: "DAMAGE" }
    : (first(list, (a) => HIT_DAMAGE_LABELS.has(bareLabel(a.label))) ?? first(list, (a) => isNamedHit(bareLabel(a.label))) ?? rolledDamage(list));
  const duration = first(list, (a) => /DURATION$/.test(bareLabel(a.label)) && !/STUN|SLOW|VISION/.test(a.label));
  // Shadow Word's "HEAL/DAMAGE" is per second over its duration; Death Coil's "DAMAGE/HEAL" is one hit.
  const perSecond = !!named && HEAL_OR_DAMAGE.has(bareLabel(named.label)) && !!first(list, (a) => a.label === "DURATION");
  const hit = perSecond ? undefined : named;
  const dot = perSecond ? named : first(list, (a) => DOT_LABELS.has(bareLabel(a.label)));
  const dotTotal = dot && duration ? dot.values.map((v, i) => v * Math.min(LANE_DOT_SECONDS, duration.values[Math.min(i, duration.values.length - 1)] ?? 0)) : undefined;
  const values = hit && dotTotal ? addLevels(hit.values, dotTotal) : (hit?.values ?? dotTotal);
  if (!values) return undefined;
  const tag = hit && "key" in hit ? labelTag(hit.label) : undefined;
  return { values: values.map((v) => Math.round(v)), ...(tag ? { tag } : {}) };
}

/** Builds one spell's lane facts, or undefined when it has no name. `orbs` maps a label tag to a sibling ability key. */
export function toLaneSpell(key: string, raw: Record<string, unknown>, orbs: Map<string, string>): LaneSpell | undefined {
  if (typeof raw.dname !== "string" || !raw.dname) return undefined;
  const list = attribs(raw);
  const behavior = new Set(Array.isArray(raw.behavior) ? raw.behavior : [raw.behavior]);
  const passive = behavior.has("Passive");
  const nums = (v: unknown) => (positive(toNumbers(v).values) ? toNumbers(v).values : undefined);
  const one = (test: (a: Attrib) => boolean) => first(list, test)?.values;
  // A summoned unit's health: "HEALTH", "WOLF HEALTH", never a bonus, threshold or share of health.
  const health = first(list, (a) => /_(hp|health)$/.test(a.key) && /HEALTH$/.test(bareLabel(a.label)) && !/BONUS|THRESHOLD|REGEN|MIN|MAX|PCT|PERCENT|COST|LOST|DAMAGE/.test(a.label) && a.values.every((v) => v >= MIN_SUMMON_HEALTH));
  // A summon's "DAMAGE" is the unit's attack, not the spell's: leave it out.
  // A number with no damage type (Objurgation's "ALL DAMAGE", a trap's "EXTRA DAMAGE") is not a hit on a hero.
  const damageType = typeof raw.dmg_type === "string" ? DAMAGE_TYPES[raw.dmg_type] : undefined;
  const damage = health || !damageType ? undefined : damageOf(raw, list);
  const auraRadius = one((a) => /aura_radius$/.test(a.key));
  const auraDecay = list.find((a) => a.isPercent && (/DECAY/.test(a.label) || /aura_damage$/.test(a.key)));
  const widths = list.filter((a) => /width(_initial|_end)?$/.test(a.key) && positive(a.values)).flatMap((a) => a.values);
  const targetTypes = Array.isArray(raw.target_type) ? raw.target_type : typeof raw.target_type === "string" ? [raw.target_type] : [];
  const radius = one((a) => bareLabel(a.label) === "RADIUS" && !/aura|tree|vision/.test(a.key)) ?? one((a) => /(^|_)(aoe|area_of_effect)$/.test(a.key));
  const hitsUnits = targetTypes.length ? targetTypes.includes("Basic") : !!damage && (!!radius || widths.length > 0);
  const orbOf = (label: string | undefined) => (label ? orbs.get(label) : undefined);
  const levelFrom = { ...(orbOf(damage?.tag) ? { damage: orbOf(damage?.tag) } : {}), ...(orbOf(health && labelTag(health.label)) ? { summonHealth: orbOf(health && labelTag(health.label)) } : {}) };
  const castPoint = one((a) => a.key === "abilitycastpoint")?.[0];
  const castRange = one((a) => a.key === "abilitycastrange") ?? one((a) => a.key === "range");
  // How far a line travels: its own distance label, never a pull or knockback distance; else its cast range.
  const lineLength = one((a) => /(distance|length)$/.test(a.key) && /DISTANCE|LENGTH/.test(a.label) && !/PULL|KNOCK|DRAG|BONUS/.test(a.label))?.[0] ?? castRange?.[0];
  const delay = one((a) => /(^|_)delay(_time)?$/.test(a.key))?.[0];
  const stun = one((a) => /stun_duration$/.test(a.key));
  const heal = one((a) => bareLabel(a.label) === "HEAL" || a.key === "heal");
  // Damage for each point of health the target is missing, like Reaper's Scythe: an execute with no fixed number.
  const missingHealth = damageType ? one((a) => /DAMAGE PER MISSING (HP|HEALTH)$/.test(bareLabel(a.label)) && !a.isPercent) : undefined;
  const spell: LaneSpell = {
    key,
    name: titleCase(raw.dname),
    ...(passive ? { passive: true as const } : { cast: behavior.has("Point Target") ? ("point" as const) : behavior.has("Unit Target") ? ("unit" as const) : ("none" as const) }),
    ...(damage ? { damage: damage.values } : {}),
    ...(missingHealth ? { missingHealthDamage: missingHealth } : {}),
    ...((damage || missingHealth) && damageType ? { damageType } : {}),
    ...(!passive && nums(raw.cd) ? { cooldown: nums(raw.cd) } : {}),
    ...(!passive && nums(raw.mc) ? { mana: nums(raw.mc) } : {}),
    ...(castRange ? { castRange } : {}),
    ...(castPoint !== undefined ? { castPoint } : {}),
    ...(delay !== undefined ? { delay } : {}),
    ...(radius ? { radius } : {}),
    ...(widths.length ? { width: Math.max(...widths) } : {}),
    ...(widths.length && lineLength ? { length: lineLength } : {}),
    ...(stun ? { stun } : {}),
    ...(heal ? { heal } : {}),
    ...(passive && auraRadius?.[0] && auraDecay ? { aura: { radius: auraRadius[0], healthPerSecondPct: auraDecay.values } } : {}),
    ...(health ? { summonHealth: health.values } : {}),
    ...(Object.keys(levelFrom).length ? { levelFrom } : {}),
    hitsUnits,
    ...(widths.length && STOPS_AT_FIRST_UNIT.test(typeof raw.desc === "string" ? raw.desc : "") ? { stopsAtFirstUnit: true as const } : {}),
  };
  return spell;
}

/** Small words the site keeps lower case inside a title ("Arena of Blood", not the game file's "Arena Of Blood"). */
const SMALL_WORDS = new Set(["a", "an", "and", "the", "of", "to", "from", "in", "on", "for", "by", "with"]);

/** A spell name in the site's Title Case: small words lower case unless first. */
export function titleCase(name: string): string {
  return name
    .split(" ")
    .map((word, i) => (i > 0 && SMALL_WORDS.has(word.toLowerCase()) ? word.toLowerCase() : word))
    .join(" ");
}

/** How a spell's own text says it stops at the first unit it meets (Meat Hook, Sacred Arrow, Hookshot). */
const STOPS_AT_FIRST_UNIT = /first (enemy )?unit|hook hits a unit/i;

/** Whether a spell has any number a lane rule reads; the rest are left out to keep the file small. */
function mattersInLane(s: LaneSpell): boolean {
  return !!(s.damage || s.heal || s.aura || s.summonHealth || s.stun || s.delay !== undefined || s.width);
}

const pair = (base: unknown, gain: unknown): [number, number] | undefined =>
  typeof base === "number" && typeof gain === "number" ? [base, gain] : undefined;

/** A hero's base numbers, or undefined when the constants miss any of them. */
export function toLaneHero(raw: Record<string, unknown>): Omit<LaneHero, "spells"> | undefined {
  const name = typeof raw.name === "string" ? raw.name.replace(/^npc_dota_hero_/, "") : undefined;
  const primary = raw.primary_attr;
  const str = pair(raw.base_str, raw.str_gain);
  const agi = pair(raw.base_agi, raw.agi_gain);
  const int = pair(raw.base_int, raw.int_gain);
  const numbers = ["base_health", "base_mana", "base_armor", "base_mr", "base_attack_min", "base_attack_max", "attack_range", "attack_rate", "move_speed"] as const;
  if (!name || !str || !agi || !int || !numbers.every((k) => typeof raw[k] === "number")) return undefined;
  if (primary !== "str" && primary !== "agi" && primary !== "int" && primary !== "all") return undefined;
  // Checked just above: every one of `numbers` is a number.
  const n = (k: (typeof numbers)[number]) => raw[k] as number;
  return {
    name,
    primary,
    baseHealth: n("base_health"),
    baseMana: n("base_mana"),
    baseArmor: n("base_armor"),
    baseMagicResist: n("base_mr"),
    attackMin: n("base_attack_min"),
    attackMax: n("base_attack_max"),
    attackRange: n("attack_range"),
    attackRate: n("attack_rate"),
    moveSpeed: n("move_speed"),
    str,
    agi,
    int,
  };
}

/** Ability keys in a hero's list, which OpenDota sometimes nests one level (alternate forms). */
function abilityKeys(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list.flatMap((k): string[] => (typeof k === "string" ? [k] : Array.isArray(k) ? k.filter((x): x is string => typeof x === "string") : []));
}

/**
 * Builds the lane facts from the three constants. Innate abilities are left out (they have no level to
 * read). Throws when a constant is not an object, so a changed API never writes a broken file.
 */
export function toLaneFacts(abilities: unknown, heroAbilities: unknown, heroes: unknown): LaneFacts {
  if (!isRecord(abilities) || !isRecord(heroAbilities) || !isRecord(heroes)) throw new Error("OpenDota constants are not objects");
  const facts: LaneFacts = { heroes: {}, spells: {} };
  for (const [id, rawHero] of Object.entries(heroes)) {
    if (!isRecord(rawHero) || typeof rawHero.name !== "string") continue;
    const hero = toLaneHero(rawHero);
    const entry = heroAbilities[rawHero.name];
    if (!hero || !isRecord(entry)) continue;
    const own = abilityKeys(entry.abilities).filter((k) => isRecord(abilities[k]) && abilities[k].is_innate !== true);
    // A label tag naming another of the hero's abilities ("HEALTH (QUAS)") means that ability sets the level.
    const orbs = new Map<string, string>();
    for (const k of own) {
      const dname = (abilities[k] as Record<string, unknown>).dname;
      if (typeof dname === "string") orbs.set(dname.toUpperCase(), k);
    }
    const spells: string[] = [];
    for (const key of own) {
      const spell = toLaneSpell(key, abilities[key] as Record<string, unknown>, orbs);
      if (!spell || !mattersInLane(spell)) continue;
      facts.spells[key] = spell;
      spells.push(key);
    }
    facts.heroes[id] = { ...hero, spells };
  }
  return facts;
}

/** Fewer heroes than this means the constants came back cut short; Dota has over 120. */
const MIN_HEROES = 100;

/** Downloads the constants and builds the lane facts. */
export async function fetchLaneFacts(): Promise<LaneFacts> {
  // One after another: the client spaces its requests, and parallel calls would skip that.
  const abilities = await getOpenDota<unknown>("/constants/abilities");
  const heroAbilities = await getOpenDota<unknown>("/constants/hero_abilities");
  const heroes = await getOpenDota<unknown>("/constants/heroes");
  const facts = toLaneFacts(abilities, heroAbilities, heroes);
  const count = Object.keys(facts.heroes).length;
  if (count < MIN_HEROES) throw new Error(`Lane facts cover only ${count} heroes`);
  return facts;
}
