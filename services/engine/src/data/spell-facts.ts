/**
 * Facts about every hero's spells from OpenDota's game constants: whether a dispel removes the spell's
 * effect, whether it goes through Black King Bar, which team the cast targets, and whether an upgrade
 * makes it undispellable. The engine reads them (src/engine/spell-facts.ts) so
 * an answer item is chosen from what a spell does, not from a hand-typed list of hero names.
 *
 * The constants come from the game files and change with each patch, so the facts are written to a
 * committed file (scripts/spell-facts.ts) and the diff is reviewed in a pull request.
 */
import type { RemovedBy, SpellFact, SpellFacts, Target } from "../engine/spell-facts";
import { getOpenDota } from "./opendota";

/** The parts of OpenDota's constants/abilities rows that the facts use. */
interface RawAbility {
  dname?: unknown;
  dispellable?: unknown;
  bkbpierce?: unknown;
  target_team?: unknown;
  attrib?: unknown;
}

const REMOVED_BY: Record<string, RemovedBy> = { Yes: "basic", "Strong Dispels Only": "strong", No: "none" };
const PIERCES: Record<string, boolean> = { Yes: true, No: false };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** OpenDota's target_team: a string, a list of strings, or empty. */
function toTarget(team: unknown): Target | undefined {
  const teams = new Set(Array.isArray(team) ? team : [team]);
  const enemy = teams.has("Enemy") || teams.has("Both");
  const friendly = teams.has("Friendly") || teams.has("Both");
  return enemy && friendly ? "both" : enemy ? "enemies" : friendly ? "allies" : undefined;
}

/** Attribute keys that mean a talent, facet or shard makes the spell's effect undispellable. */
const UNDISPELLABLE_KEYS = new Set(["cannot_be_dispelled", "undispellable"]);

function hasUndispellableUpgrade(attrib: unknown): boolean {
  return Array.isArray(attrib) && attrib.some((a) => isRecord(a) && typeof a.key === "string" && UNDISPELLABLE_KEYS.has(a.key));
}

/** Ability names in a hero's list, which OpenDota sometimes nests one level (alternate forms). */
function abilityKeys(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list.flatMap((k): string[] => (typeof k === "string" ? [k] : Array.isArray(k) ? k.filter((x): x is string => typeof x === "string") : []));
}

/**
 * Builds the facts from the three OpenDota constants (abilities, hero_abilities, heroes). Abilities without
 * a game name (talents, `generic_hidden`) are left out. Throws when a constant is not an object, so a
 * changed API never writes a broken facts file.
 */
export function toSpellFacts(abilities: unknown, heroAbilities: unknown, heroes: unknown): SpellFacts {
  if (!isRecord(abilities) || !isRecord(heroAbilities) || !isRecord(heroes)) throw new Error("OpenDota constants are not objects");
  const displayName = new Map<string, string>();
  for (const hero of Object.values(heroes)) {
    if (isRecord(hero) && typeof hero.name === "string" && typeof hero.localized_name === "string") displayName.set(hero.name, hero.localized_name);
  }
  const facts: SpellFacts = {};
  for (const [npcName, entry] of Object.entries(heroAbilities)) {
    const hero = displayName.get(npcName);
    if (!hero || !isRecord(entry)) continue;
    const spells = abilityKeys(entry.abilities).flatMap((key): SpellFact[] => {
      const raw = abilities[key];
      if (!isRecord(raw)) return [];
      const { dname, dispellable, bkbpierce, target_team, attrib } = raw as RawAbility;
      if (typeof dname !== "string" || !dname) return [];
      const removedBy = typeof dispellable === "string" ? REMOVED_BY[dispellable] : undefined;
      const piercesBkb = typeof bkbpierce === "string" ? PIERCES[bkbpierce] : undefined;
      const target = toTarget(target_team);
      return [
        {
          key,
          name: dname,
          ...(removedBy ? { removedBy } : {}),
          ...(piercesBkb !== undefined ? { piercesBkb } : {}),
          ...(target ? { target } : {}),
          ...(removedBy && removedBy !== "none" && hasUndispellableUpgrade(attrib) ? { unlessUpgraded: true } : {}),
        },
      ];
    });
    if (spells.length) facts[hero] = spells;
  }
  return facts;
}

/** Fewer heroes than this means the constants came back cut short; Dota has over 120. */
const MIN_HEROES = 100;

/** Downloads the constants and builds the facts. */
export async function fetchSpellFacts(): Promise<SpellFacts> {
  // One after another: the client spaces its requests, and parallel calls would skip that.
  const abilities = await getOpenDota<unknown>("/constants/abilities");
  const heroAbilities = await getOpenDota<unknown>("/constants/hero_abilities");
  const heroes = await getOpenDota<unknown>("/constants/heroes");
  const facts = toSpellFacts(abilities, heroAbilities, heroes);
  const count = Object.keys(facts).length;
  if (count < MIN_HEROES) throw new Error(`Spell facts cover only ${count} heroes`);
  return facts;
}
