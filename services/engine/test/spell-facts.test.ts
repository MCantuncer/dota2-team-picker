import { describe, expect, it } from "vitest";
import { toSpellFacts } from "../src/data/spell-facts";
import { KEY_SPELLS } from "../src/engine/data-key-spells";
import { SPELL_FACTS } from "../src/engine/data-spell-facts";
import { heroSpells, isRemovedByBasicDispel, OVERRIDES, piercesBkb, spellFact } from "../src/engine/spell-facts";

const heroes = { 36: { name: "npc_dota_hero_necrolyte", localized_name: "Necrophos" } };
const heroAbilities = {
  npc_dota_hero_necrolyte: { abilities: ["necrolyte_death_pulse", ["necrolyte_ghost_shroud"], "generic_hidden", "necrolyte_reapers_scythe"] },
  npc_dota_hero_unknown: { abilities: ["unknown_spell"] },
};
const abilities = {
  necrolyte_death_pulse: { dname: "Death Pulse" },
  necrolyte_ghost_shroud: { dname: "Ghost Shroud", dispellable: "Yes", bkbpierce: "No" },
  generic_hidden: {},
  necrolyte_reapers_scythe: { dname: "Reaper's Scythe", dispellable: "Strong Dispels Only", bkbpierce: "Yes" },
};

describe("toSpellFacts", () => {
  it("lists each hero's named spells with the facts OpenDota gives, nested lists included", () => {
    expect(toSpellFacts(abilities, heroAbilities, heroes)).toEqual({
      Necrophos: [
        { key: "necrolyte_death_pulse", name: "Death Pulse" },
        { key: "necrolyte_ghost_shroud", name: "Ghost Shroud", removedBy: "basic", piercesBkb: false },
        { key: "necrolyte_reapers_scythe", name: "Reaper's Scythe", removedBy: "strong", piercesBkb: true },
      ],
    });
  });

  it("leaves out values it does not know, like an empty list for bkbpierce", () => {
    const facts = toSpellFacts({ necrolyte_death_pulse: { dname: "Death Pulse", bkbpierce: [], dispellable: "Maybe" } }, heroAbilities, heroes);
    expect(facts.Necrophos).toEqual([{ key: "necrolyte_death_pulse", name: "Death Pulse" }]);
  });

  it("throws on constants that are not objects", () => {
    expect(() => toSpellFacts([], heroAbilities, heroes)).toThrow();
  });
});

describe("spell facts", () => {
  it("covers every Dota hero", () => {
    expect(Object.keys(SPELL_FACTS).length).toBeGreaterThanOrEqual(120);
  });

  it("stays small, since the website bundles the engine", () => {
    expect(JSON.stringify(SPELL_FACTS).length).toBeLessThan(80_000);
  });

  it("knows every key spell of Their Threats, under the right hero", () => {
    for (const [hero, spell] of Object.entries(KEY_SPELLS)) {
      expect(heroSpells(hero).map((s) => s.key), hero).toContain(spell.key);
    }
  });

  it("says Ghost Shroud and Decrepify go with a basic dispel, Refraction and Shallow Grave do not", () => {
    expect(isRemovedByBasicDispel("necrolyte_ghost_shroud")).toBe(true);
    expect(isRemovedByBasicDispel("pugna_decrepify")).toBe(true);
    expect(isRemovedByBasicDispel("templar_assassin_refraction")).toBe(false);
    expect(isRemovedByBasicDispel("dazzle_shallow_grave")).toBe(false);
  });

  it("says Exorcism and Black Hole work on spell-immune heroes, Fireblast does not", () => {
    expect(piercesBkb("death_prophet_exorcism")).toBe(true);
    expect(piercesBkb("enigma_black_hole")).toBe(true);
    expect(piercesBkb("ogre_magi_fireblast")).toBe(false);
  });

  it("answers no for a spell it doesn't know", () => {
    expect(spellFact("not_a_spell")).toBeUndefined();
    expect(piercesBkb("not_a_spell")).toBe(false);
    expect(heroSpells("Not a Hero")).toEqual([]);
  });

  it("overrides only spells the facts have, each with a reason", () => {
    for (const [key, fix] of Object.entries(OVERRIDES)) {
      expect(spellFact(key), key).toBeDefined();
      expect(fix.why.length, key).toBeGreaterThan(10);
    }
  });
});
