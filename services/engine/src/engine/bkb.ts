/**
 * Which enemies Black King Bar answers, from the hand-kept key spells (data-key-spells.ts): one source for
 * the counter item rule, its effect line and Their Threats, so none of them pairs it with Black Hole.
 */
import { abilityRules } from "./ability-notes";
import { KEY_SPELLS, PIERCES_BKB } from "./data-key-spells";
import type { HeroInfo } from "./types";

/**
 * Heroes whose main disable may go through Black King Bar in this patch, but not surely enough to say so.
 * Black King Bar doesn't name them as heroes it stops, and doesn't warn about them either.
 */
const UNSURE_VS_BKB = new Set(["Naga Siren"]);

/** Disables that go through Black King Bar but are not the hero's key spell. */
const OTHER_PIERCING_DISABLES: Record<string, string> = { "Troll Warlord": "Troll Warlord's bash" };

/**
 * How the key spell goes through Black King Bar, from the hand list, unless Valve's note says debuff immunity
 * stops it or ends it (Global Silence): the game's own text wins over the list.
 */
function pierces(key: string): "lock" | "damage" | undefined {
  const immunity = abilityRules(key)?.debuffImmunity;
  return immunity === "blocked" || immunity === "removed" ? undefined : PIERCES_BKB[key];
}

/** What goes through Black King Bar for this hero, named for the line, else undefined. */
export function piercingSpell(hero: HeroInfo): string | undefined {
  const spell = KEY_SPELLS[hero.name];
  return spell && pierces(spell.key) ? spell.name : OTHER_PIERCING_DISABLES[hero.name];
}

/**
 * Whether Black King Bar is no answer to the hero: the hero's lock goes through it (Black Hole, Duel), or
 * may. Death Prophet's Exorcism goes through but only hurts, and Black King Bar still stops her Silence.
 */
export function beatsBkb(hero: HeroInfo): boolean {
  const spell = KEY_SPELLS[hero.name];
  return (spell !== undefined && pierces(spell.key) === "lock") || hero.name in OTHER_PIERCING_DISABLES || UNSURE_VS_BKB.has(hero.name);
}
