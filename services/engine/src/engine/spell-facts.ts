/**
 * What each hero's spells do, so answer items are chosen from mechanics, never from hero names: which
 * dispel removes a spell's effect, whether it works on spell-immune heroes, which team its effect lands on
 * and what that effect does. Most facts are generated from OpenDota's game constants (data-spell-facts.ts,
 * `npm run spell-facts`); where the constants can't say, a reviewed table covers every spell
 * (data-spell-landing.ts), and OVERRIDES fixes the few the constants get wrong, each with its reason.
 */
import { SPELL_FACTS } from "./data-spell-facts";
import { SPELL_LANDING } from "./data-spell-landing";

/** How a spell's effect can be removed: by any dispel, only by a strong dispel, or not at all. */
export type RemovedBy = "basic" | "strong" | "none";

/** Which team a spell's cast can target (OpenDota's target_team), or which team its effect lands on. */
export type Target = "enemies" | "allies" | "both";

/**
 * What an effect that lands on a hero's own team does, in game terms. Only mechanics, so a rule reads
 * "makes a hero unable to be attacked", never a spell's name.
 */
export type Effect =
  | "unattackable"
  | "evasion"
  | "shield"
  | "heal"
  | "speed"
  | "attack"
  | "armor"
  | "magic resist"
  | "debuff immune"
  | "spell block";

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
  /** Which team the cast can target (OpenDota's target_team). Not always where the effect lands: see `landsOn`. */
  target?: Target;
  /** A talent, facet or shard can make the effect undispellable, so a dispel answer says "unless upgraded". */
  unlessUpgraded?: boolean;
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

/**
 * Which team the spell's dispellable effect lands on: the reviewed table first, then the cast target when
 * OpenDota says it is enemies only. Undefined for a spell no dispel touches.
 */
export function landsOn(key: string): Target | undefined {
  const reviewed = SPELL_LANDING[key];
  if (reviewed) return reviewed.lands;
  return byKey.get(key)?.target === "enemies" ? "enemies" : undefined;
}

/** What the effect the spell puts on its own team does; empty for a spell that only lands on enemies. */
export function effectsOn(key: string): readonly Effect[] {
  return SPELL_LANDING[key]?.effects ?? [];
}
