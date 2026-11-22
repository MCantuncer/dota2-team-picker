/**
 * Hidden rules from Valve's own ability notes, the "Note" lines a player sees with ALT in game: whether Break
 * turns a passive off, whether Linken's Sphere blocks a spell, whether a projectile can be dodged, whether a
 * spell hits invisible heroes or works through debuff immunity, and which spell still kills through a save.
 * Tooltips and OpenDota's constants don't carry these, and getting them wrong gives wrong advice (Force Staff
 * sold against Chronosphere, Black King Bar hidden against Global Silence).
 *
 * The rules are generated from the game's text (data-ability-notes.ts, `npm run ability-notes`) and the diff is
 * reviewed after each patch. A rule is only set when a note says it; no note means the engine doesn't know.
 */
import { ABILITY_NOTES } from "./data-ability-notes";

/** How a spell meets debuff immunity (Black King Bar): it goes through, it is stopped, or gaining immunity ends it. */
export type DebuffImmunity = "pierces" | "blocked" | "removed";

/** The rules Valve's notes give for one ability or item. Every field is left out when no note says it. */
export interface AbilityRules {
  /** true when a note says Break turns (part of) it off, false when a note says Break doesn't. */
  breaks?: boolean;
  /** A note says Linken's Sphere doesn't block it. */
  linkenProof?: true;
  /** true when a note says its projectile can be dodged (disjointed), false when it can't. */
  dodgeable?: boolean;
  /** true when a note says it hits invisible heroes, false when it doesn't. */
  hitsInvisible?: boolean;
  /** How it meets debuff immunity, when a note says. */
  debuffImmunity?: DebuffImmunity;
  /** A note says it destroys illusions outright. */
  killsIllusions?: true;
  /** The spell a note says still kills through it, like "Axe's Culling Blade". */
  killedBy?: string;
  /** The locks a note says it doesn't work inside, like ["Chronosphere", "Duel", "Black Hole"] for Force Staff. */
  failsInside?: readonly string[];
  /** Valve's note lines behind these rules, as the game shows them. */
  notes: readonly string[];
}

/** Rules by Dota's internal ability or item name, like `troll_warlord_battle_trance` or `item_force_staff`. */
export type AbilityNotes = Record<string, AbilityRules>;

/** The rules Valve's notes give for an ability or item, or undefined when its notes set none. */
export const abilityRules = (key: string): AbilityRules | undefined => ABILITY_NOTES[key];
