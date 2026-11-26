import { afterEach, describe, expect, it } from "vitest";
import { buildFactUpdates, changedEntries, describeUpdates, type FactSources } from "../src/data/fact-updates";
import { abilityRules } from "../src/engine/ability-notes";
import { beatsBkb } from "../src/engine/bkb";
import { ABILITY_NOTES } from "../src/engine/data-ability-notes";
import { ITEM_FACTS } from "../src/engine/data-item-facts";
import { LANE_FACTS } from "../src/engine/data-lane-facts";
import { SPELL_FACTS } from "../src/engine/data-spell-facts";
import { applyFactUpdates, type FactUpdates } from "../src/engine/fact-updates";
import { itemFact } from "../src/engine/item-facts";
import { laneHero } from "../src/engine/lane-facts";
import { heroSpells, keySpell, spellFact } from "../src/engine/spell-facts";
import type { HeroInfo } from "../src/engine/types";

const NOW = new Date("2026-11-26T12:00:00.000Z");
const same: FactSources = {
  abilityNotes: async () => ({ ...ABILITY_NOTES }),
  itemFacts: async () => ({ ...ITEM_FACTS }),
  spellFacts: async () => ({ ...SPELL_FACTS }),
  laneFacts: async () => ({ heroes: { ...LANE_FACTS.heroes }, spells: { ...LANE_FACTS.spells } }),
};

afterEach(() => applyFactUpdates(undefined));

describe("generating the facts on each refresh", () => {
  it("keeps only what differs, null for what is gone", () => {
    expect(changedEntries({ a: 1, b: { x: 1 }, c: 3 }, { a: 1, b: { x: 2 }, c: 3, d: 4 })).toEqual({ b: { x: 2 }, d: 4 });
    const base = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`k${i}`, i]));
    const fresh = { ...base };
    delete fresh.k0;
    expect(changedEntries(base, fresh)).toEqual({ k0: null });
  });

  it("refuses a part that came back cut short", () => {
    expect(() => changedEntries({ a: 1, b: 2, c: 3 }, { a: 1 })).toThrow("only 1 of 3");
  });

  it("has nothing to update when the sources match the committed files", async () => {
    const { updates, notes } = await buildFactUpdates(undefined, NOW, same);
    expect(updates).toEqual({ at: NOW.toISOString() });
    expect(notes).toEqual([]);
    expect(describeUpdates(updates)).toBe("abilityNotes 0, itemFacts 0, spellFacts 0, laneHeroes 0, laneSpells 0");
  });

  it("keeps the last updates of a part that fails", async () => {
    const last: FactUpdates = { at: "2026-11-25T00:00:00.000Z", itemFacts: { bracer: { attack: true } }, laneHeroes: { "1": null } };
    const failing: FactSources = {
      ...same,
      itemFacts: async () => {
        throw new Error("HTTP 500");
      },
      laneFacts: async () => {
        throw new Error("HTTP 500");
      },
    };
    const { updates, notes } = await buildFactUpdates(last, NOW, failing);
    expect(updates).toEqual({ at: NOW.toISOString(), itemFacts: last.itemFacts, laneHeroes: last.laneHeroes });
    expect(notes).toHaveLength(2);
  });
});

describe("the engine reads the updates", () => {
  it("uses an updated entry, and the committed one otherwise", () => {
    expect(itemFact("bracer")).toEqual(ITEM_FACTS.bracer ?? {});
    applyFactUpdates({ at: "", itemFacts: { bracer: { attack: true } }, laneHeroes: { "1": null } });
    expect(itemFact("bracer")).toEqual({ attack: true });
    expect(laneHero(1)).toBeUndefined();
    expect(laneHero(2)).toEqual(LANE_FACTS.heroes["2"]);
    applyFactUpdates(undefined);
    expect(laneHero(1)).toEqual(LANE_FACTS.heroes["1"]);
  });

  it("builds the spell table again when the updates change", () => {
    const axe = SPELL_FACTS.Axe!;
    expect(spellFact("axe_culling_blade")).toBeDefined();
    applyFactUpdates({ at: "", spellFacts: { Axe: axe.filter((s) => s.key !== "axe_culling_blade") } });
    expect(spellFact("axe_culling_blade")).toBeUndefined();
    expect(heroSpells("Axe").map((s) => s.key)).not.toContain("axe_culling_blade");
  });

  it("reads updated ability notes", () => {
    const key = Object.keys(ABILITY_NOTES)[0]!;
    applyFactUpdates({ at: "", abilityNotes: { [key]: null } });
    expect(abilityRules(key)).toBeUndefined();
  });

  it("hides a hand-picked key spell the hero no longer has", () => {
    const enigma = { name: "Enigma" } as HeroInfo;
    expect(keySpell("Enigma")?.key).toBe("enigma_black_hole");
    expect(beatsBkb(enigma)).toBe(true);
    applyFactUpdates({ at: "", spellFacts: { Enigma: SPELL_FACTS.Enigma!.filter((s) => s.key !== "enigma_black_hole") } });
    expect(keySpell("Enigma")).toBeUndefined();
    expect(beatsBkb(enigma)).toBe(false);
  });
});
