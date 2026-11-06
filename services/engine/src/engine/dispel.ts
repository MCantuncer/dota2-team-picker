/**
 * The enemy buffs a basic dispel like Nullifier removes, from the hand-kept list (data-dispellable-buffs.ts)
 * checked against the spell facts, so Nullifier is offered for Decrepify and Ghost Shroud and never for
 * Shallow Grave.
 */
import { DISPELLABLE_BUFFS } from "./data-dispellable-buffs";
import { heroSpells, isRemovedByBasicDispel, type SpellFact } from "./spell-facts";
import type { HeroInfo } from "./types";

/** The hero's spells that put a buff on them or an ally which a basic dispel removes, in ability order. */
export function dispellableBuffs(hero: HeroInfo): SpellFact[] {
  return heroSpells(hero.name).filter((s) => DISPELLABLE_BUFFS.has(s.key) && isRemovedByBasicDispel(s.key));
}

/** "Decrepify from Pugna and Ghost Shroud from Necrophos": each hero's first dispellable buff. */
export function buffsFrom(heroes: HeroInfo[]): string[] {
  return heroes.flatMap((h) => {
    const first = dispellableBuffs(h)[0];
    return first ? [`${first.name} from ${h.name}`] : [];
  });
}
