/**
 * Generates the engine's game facts again on each refresh and keeps what differs from the committed files (see
 * engine/fact-updates.ts), so a patch's changes reach the site on the next refresh with no rerun of the scripts.
 * Each part is generated on its own: a part that fails, or comes back much smaller than the committed one (a cut
 * short download), keeps the last refresh's updates for that part.
 */
import { ABILITY_NOTES } from "../engine/data-ability-notes";
import { ITEM_FACTS } from "../engine/data-item-facts";
import { LANE_FACTS } from "../engine/data-lane-facts";
import { SPELL_FACTS } from "../engine/data-spell-facts";
import type { FactUpdates } from "../engine/fact-updates";
import { fetchAbilityNotes } from "./ability-notes";
import { fetchItemFacts } from "./item-facts";
import { fetchLaneFacts } from "./lane-facts";
import { fetchSpellFacts } from "./spell-facts";

/** A generated part with fewer keys than this share of the committed one is taken as cut short. */
export const MIN_KEY_SHARE = 0.9;

/** The entries of `fresh` that differ from `base`, and null for a key `fresh` no longer has. Throws when cut short. */
export function changedEntries(base: Readonly<Record<string, unknown>>, fresh: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const baseKeys = Object.keys(base);
  const freshKeys = Object.keys(fresh);
  if (freshKeys.length < baseKeys.length * MIN_KEY_SHARE) throw new Error(`only ${freshKeys.length} of ${baseKeys.length} entries`);
  const out: Record<string, unknown> = {};
  for (const key of freshKeys) if (JSON.stringify(fresh[key]) !== JSON.stringify(base[key])) out[key] = fresh[key]!;
  for (const key of baseKeys) if (!Object.hasOwn(fresh, key)) out[key] = null;
  return out;
}

type Part = Exclude<keyof FactUpdates, "at">;

export interface FactSources {
  abilityNotes: () => Promise<Record<string, unknown>>;
  itemFacts: () => Promise<Record<string, unknown>>;
  spellFacts: () => Promise<Record<string, unknown>>;
  laneFacts: () => Promise<{ heroes: Record<string, unknown>; spells: Record<string, unknown> }>;
}

const SOURCES: FactSources = {
  abilityNotes: fetchAbilityNotes,
  itemFacts: fetchItemFacts,
  spellFacts: fetchSpellFacts,
  laneFacts: fetchLaneFacts,
};

/**
 * The updates against the committed files, with notes for the log. A failed part keeps `last`'s entries for it.
 */
export async function buildFactUpdates(last: FactUpdates | undefined, now: Date, sources: FactSources = SOURCES): Promise<{ updates: FactUpdates; notes: string[] }> {
  const parts: Partial<Record<Part, Record<string, unknown>>> = {};
  const notes: string[] = [];
  const part = async (name: Part | "laneFacts", build: () => Promise<void>) => {
    try {
      await build();
    } catch (err) {
      notes.push(`${name} failed, keeping the last: ${(err as Error).message}`);
      const keep: Part[] = name === "laneFacts" ? ["laneHeroes", "laneSpells"] : [name];
      for (const k of keep) if (last?.[k]) parts[k] = last[k];
    }
  };
  const set = (name: Part, changes: Record<string, unknown>) => {
    if (Object.keys(changes).length) parts[name] = changes;
  };
  // One after another: each reads OpenDota's constants, and the client spaces its requests.
  await part("abilityNotes", async () => set("abilityNotes", changedEntries(ABILITY_NOTES, await sources.abilityNotes())));
  await part("itemFacts", async () => set("itemFacts", changedEntries(ITEM_FACTS, await sources.itemFacts())));
  await part("spellFacts", async () => set("spellFacts", changedEntries(SPELL_FACTS, await sources.spellFacts())));
  await part("laneFacts", async () => {
    const lane = await sources.laneFacts();
    const heroes = changedEntries(LANE_FACTS.heroes, lane.heroes);
    const spells = changedEntries(LANE_FACTS.spells, lane.spells);
    set("laneHeroes", heroes);
    set("laneSpells", spells);
  });
  // The parts are the generators' own types, compared as JSON.
  return { updates: { at: now.toISOString(), ...parts } as FactUpdates, notes };
}

/** "abilityNotes 0, itemFacts 5, ..." for the log. */
export function describeUpdates(updates: FactUpdates): string {
  const parts: Part[] = ["abilityNotes", "itemFacts", "spellFacts", "laneHeroes", "laneSpells"];
  return parts.map((p) => `${p} ${Object.keys(updates[p] ?? {}).length}`).join(", ");
}
