import { describe, expect, it } from "vitest";
import { parseNotes, toAbilityNotes, toRules } from "../src/data/ability-notes";
import { abilityRules } from "../src/engine/ability-notes";
import { ABILITY_NOTES } from "../src/engine/data-ability-notes";

const TEXT = [
  '\t\t"DOTA_Tooltip_ability_troll_warlord_battle_trance_Note0"\t\t"Troll can still use his items."',
  '\t\t"DOTA_Tooltip_ability_troll_warlord_battle_trance_Note1"\t\t"Troll can still be killed with Axe\'s Culling Blade."',
  '\t\t"DOTA_Tooltip_Ability_item_hurricane_pike_Note2"\t\t"Will not work on a unit inside Chronosphere, Duel, or Black Hole."',
  '\t\t"DOTA_Tooltip_ability_mana_break_Note0"\t\t"Burns 50%% of \\"mana\\"."',
  '\t\t"DOTA_Tooltip_ability_troll_warlord_battle_trance_Description"\t\t"Not a note."',
].join("\r\n");

describe("parseNotes", () => {
  it("reads every Note line by ability, any key case, and undoes escapes and doubled %", () => {
    const notes = parseNotes(TEXT);
    expect(notes.get("troll_warlord_battle_trance")).toEqual(["Troll can still use his items.", "Troll can still be killed with Axe's Culling Blade."]);
    expect(notes.get("item_hurricane_pike")).toHaveLength(1);
    expect(notes.get("mana_break")).toEqual(['Burns 50% of "mana".']);
  });
});

describe("toRules", () => {
  it.each([
    [["Break disables the gaining of new stacks."], { breaks: true }],
    [["Intelligence Steal is not disabled by Break."], { breaks: false }],
    [["Fissure is not blocked by Linken's Sphere."], { linkenProof: true }],
    [["Impale cannot be blocked by Linken's Sphere."], { linkenProof: true }],
    [["Chain Frost cannot be disjointed."], { dodgeable: false }],
    [["Shackleshot can be disjointed."], { dodgeable: true }],
    [["Ravage will hit invisible units."], { hitsInvisible: true }],
    [["Starstorm cannot hit invisible units."], { hitsInvisible: false }],
    [["Works on Spell Immune units."], { debuffImmunity: "pierces" }],
    [["Does not work on Debuff Immune units or Roshan."], { debuffImmunity: "blocked" }],
    [["This skill works on invisible and Debuff Immune units, but gaining debuff immunity will remove its effect."], { debuffImmunity: "removed" }],
    [["Instantly destroys illusions."], { killsIllusions: true }],
    [["Troll can still be killed with Axe's Culling Blade."], { killedBy: "Axe's Culling Blade" }],
    [["Will not work on a unit inside Chronosphere, Duel, or Black Hole."], { failsInside: ["Chronosphere", "Duel", "Black Hole"] }],
  ])("reads %j", (notes, rules) => {
    expect(toRules(notes)).toEqual({ ...rules, notes });
  });

  it("keeps only the notes that state a rule, and returns null when none does", () => {
    expect(toRules(["Troll is granted vision over the target.", "Break disables the damage aura."])).toEqual({ breaks: true, notes: ["Break disables the damage aura."] });
    expect(toRules(["Invisibility doesn't disjoint the projectile.", "Break does not disable the bonuses from existing stacks."])).toBeNull();
  });
});

describe("toAbilityNotes", () => {
  it("refuses a cut-short file", () => {
    expect(() => toAbilityNotes(TEXT)).toThrow(/Only 4 ability notes/);
  });
});

describe("the generated rules", () => {
  it("hold the rules the hidden rules audit found", () => {
    expect(abilityRules("troll_warlord_battle_trance")?.killedBy).toBe("Axe's Culling Blade");
    expect(abilityRules("silencer_global_silence")?.debuffImmunity).toBe("removed");
    expect(abilityRules("item_force_staff")?.failsInside).toEqual(["Chronosphere", "Duel", "Black Hole"]);
    expect(abilityRules("earthshaker_fissure")?.linkenProof).toBe(true);
    expect(abilityRules("lion_voodoo")?.killsIllusions).toBe(true);
    expect(abilityRules("mars_bulwark")?.breaks).toBe(true);
  });

  it("are free of dashes and unfilled game values", () => {
    for (const [key, rules] of Object.entries(ABILITY_NOTES)) {
      for (const note of rules.notes) {
        expect(note, key).not.toMatch(/[—–]/);
        expect(note, key).not.toMatch(/%\w+%/);
      }
    }
  });
});
