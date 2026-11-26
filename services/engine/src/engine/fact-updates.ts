/**
 * The game facts the engine reads (data-ability-notes, data-item-facts, data-lane-facts, data-spell-facts) are
 * generated into committed files, which only change when someone reruns the scripts. Each refresh generates them
 * again from the same sources and puts what differs in the snapshot (Snapshot.factUpdates), so a patch's changes
 * reach the engine on the next refresh with no code change. Whoever loads the snapshot calls applyFactUpdates once;
 * the fact getters read through it. Without updates the committed files are used as they are.
 */
import type { AbilityRules } from "./ability-notes";
import type { ItemFact } from "./item-facts";
import type { LaneHero, LaneSpell } from "./lane-facts";
import type { SpellFact } from "./spell-facts";

/** Entries that differ from the committed files, by the same keys; null for one the game no longer has. */
export interface FactUpdates {
  /** When the facts were generated. */
  at: string;
  abilityNotes?: Record<string, AbilityRules | null>;
  itemFacts?: Record<string, ItemFact | null>;
  /** By hero display name, the hero's whole spell list. */
  spellFacts?: Record<string, readonly SpellFact[] | null>;
  laneHeroes?: Record<string, LaneHero | null>;
  laneSpells?: Record<string, LaneSpell | null>;
}

let current: FactUpdates | undefined;
let version = 0;

/** Uses the snapshot's fact updates from now on (undefined goes back to the committed files). */
export function applyFactUpdates(updates: FactUpdates | undefined): void {
  current = updates;
  version++;
}

/** The updates in use, if any. */
export function factUpdates(): FactUpdates | undefined {
  return current;
}

/** Goes up each time the updates change, so a table built from the facts knows to build again. */
export function factVersion(): number {
  return version;
}

/** The entry for a key: the updated one when the updates have it (null meaning gone), else the committed one. */
export function updatedEntry<T>(base: Readonly<Record<string, T>>, changes: Readonly<Record<string, T | null>> | undefined, key: string): T | undefined {
  if (changes && Object.hasOwn(changes, key)) return changes[key] ?? undefined;
  return Object.hasOwn(base, key) ? base[key] : undefined;
}

/** Every key with its entry, updates applied. */
export function updatedEntries<T>(base: Readonly<Record<string, T>>, changes: Readonly<Record<string, T | null>> | undefined): [string, T][] {
  const out = new Map(Object.entries(base));
  for (const [key, value] of Object.entries(changes ?? {})) {
    if (value === null) out.delete(key);
    else out.set(key, value);
  }
  return [...out];
}
