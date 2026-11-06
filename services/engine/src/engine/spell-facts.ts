/**
 * What each hero's spells do, so answer items can be checked against mechanics: whether a basic dispel
 * (Nullifier) removes a spell's effect, and whether a spell works on spell-immune heroes. The facts are generated from
 * OpenDota's game constants (data-spell-facts.ts, `npm run spell-facts`); OVERRIDES fixes the few the
 * constants get wrong or leave out, each with its reason.
 */
import { SPELL_FACTS } from "./data-spell-facts";

/** How a spell's effect can be removed: by any dispel, only by a strong dispel, or not at all. */
export type RemovedBy = "basic" | "strong" | "none";

/** One hero spell, with the facts OpenDota gives for it. A fact OpenDota leaves out stays undefined. */
export interface SpellFact {
  /** Dota's internal ability name, like `necrolyte_ghost_shroud`. */
  key: string;
  /** The spell's name in game. */
  name: string;
  /** Which dispel removes the effects the spell puts on a hero (OpenDota's "dispellable"). */
  removedBy?: RemovedBy;
  /**
   * OpenDota's "bkbpierce": the spell works on spell-immune heroes. Broad: a save cast on a spell-immune ally
   * (Shallow Grave) or a passive (Fury Swipes) counts too, so it checks hand-kept lists, never replaces them.
   */
  piercesBkb?: boolean;
}

/** Spell facts by hero display name, in the hero's ability order. */
export type SpellFacts = Record<string, readonly SpellFact[]>;

interface Override {
  removedBy?: RemovedBy;
  piercesBkb?: boolean;
  /** Why the constants are not taken as they are. */
  why: string;
}

/**
 * Corrections to the generated facts, by spell key. Keep it short: each entry is a claim about the game
 * that a reviewer checked, and the generated file is the default.
 */
export const OVERRIDES: Record<string, Override> = {};

const byKey = new Map<string, SpellFact>();
for (const spells of Object.values(SPELL_FACTS)) {
  for (const spell of spells) {
    const fix = OVERRIDES[spell.key];
    byKey.set(spell.key, fix ? { ...spell, ...(fix.removedBy ? { removedBy: fix.removedBy } : {}), ...(fix.piercesBkb !== undefined ? { piercesBkb: fix.piercesBkb } : {}) } : spell);
  }
}

/** The facts for one spell, with overrides applied, or undefined for a key the facts don't have. */
export function spellFact(key: string): SpellFact | undefined {
  return byKey.get(key);
}

/** A hero's spells with overrides applied, by display name; empty for an unknown hero. */
export function heroSpells(heroName: string): SpellFact[] {
  return (SPELL_FACTS[heroName] ?? []).flatMap((s) => byKey.get(s.key) ?? []);
}

/** Whether OpenDota says the spell works on spell-immune heroes (see SpellFact.piercesBkb). False when the facts don't say. */
export function piercesBkb(key: string): boolean {
  return byKey.get(key)?.piercesBkb === true;
}

/** Whether any dispel, Nullifier's included, removes the spell's effect. False when the facts don't say. */
export function isRemovedByBasicDispel(key: string): boolean {
  return byKey.get(key)?.removedBy === "basic";
}
