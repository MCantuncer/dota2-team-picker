/**
 * Enemy buffs a basic dispel removes, found from the spell facts alone: a spell whose effect lands on the
 * caster's team, that any dispel removes, and that does a given thing there. No spell or hero is named, so
 * every hero is covered the same way.
 */
import { effectsOn, heroSpells, isRemovedByBasicDispel, landsOn, type Effect, type SpellFact } from "./spell-facts";
import type { HeroInfo } from "./types";

/** The hero's spells that put a buff with this effect on its own team which a basic dispel removes, in ability order. */
export function dispellableBuffs(hero: HeroInfo, effect: Effect): SpellFact[] {
  return heroSpells(hero.name).filter((s) => {
    const lands = landsOn(s.key);
    return (lands === "allies" || lands === "both") && isRemovedByBasicDispel(s.key) && effectsOn(s.key).includes(effect);
  });
}

/** "Decrepify from Pugna and Ghost Shroud from Necrophos": each hero's first such buff, flagged when an upgrade can stop the dispel. */
export function buffsFrom(heroes: HeroInfo[], effect: Effect): string[] {
  return heroes.flatMap((h) => {
    const first = dispellableBuffs(h, effect)[0];
    return first ? [`${first.name} from ${h.name}${first.unlessUpgraded ? " (unless upgraded)" : ""}`] : [];
  });
}
