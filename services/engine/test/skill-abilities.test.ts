import { describe, expect, it } from "vitest";
import {
  fillMissingTalent,
  mergeHeroAbilities,
  patchGameVersion,
  talentName,
  toHeroAbilities,
} from "../src/data/skill-abilities";
import { E, Q, R, SVEN, W } from "./skill-build-fixture";

describe("talents", () => {
  it("fills a talent the constants left out into the one open tier", () => {
    const hero = {
      ...SVEN,
      talents: SVEN.talents.map((pair, tier) => (tier === 2 ? pair.slice(0, 1) : pair)),
    };
    const filled = fillMissingTalent(hero, [{ abilityId: 15, matchCount: 5 }], new Map([[15, "+25 Movement Speed"]]));
    expect(filled[2]).toEqual(SVEN.talents[2]);
    // Two unknown ids: no guess.
    expect(
      fillMissingTalent(
        hero,
        [
          { abilityId: 15, matchCount: 5 },
          { abilityId: 77, matchCount: 1 },
        ],
        new Map(),
      ),
    ).toBe(hero.talents);
  });

  it("keeps a filled talent across runs while its tier is unchanged", () => {
    const fresh = {
      ...SVEN,
      talents: SVEN.talents.map((pair, tier) => (tier === 2 ? pair.slice(0, 1) : pair)),
    };
    expect(mergeHeroAbilities({ 18: SVEN }, { 18: fresh })[18]!.talents[2]).toEqual(SVEN.talents[2]);
    const changed = {
      ...fresh,
      talents: fresh.talents.map((pair, tier) => (tier === 2 ? [{ id: 50, name: "New" }] : pair)),
    };
    expect(mergeHeroAbilities({ 18: SVEN }, { 18: changed })[18]!.talents[2]).toEqual([{ id: 50, name: "New" }]);
  });

  it("tidies talent names", () => {
    expect(talentName("+20  Movement Speed")).toBe("+20 Movement Speed");
    expect(talentName(null)).toBe("");
    expect(talentName("+{s:value} Damage")).toBe("");
  });
});

describe("constants", () => {
  const constants = {
    gameVersions: [
      { id: 180, name: "7.38c" },
      { id: 181, name: "7.39" },
      { id: 182, name: "7.39b" },
      { id: 183, name: "7.39c" },
      { id: 190, name: "7.390" },
    ],
    heroes: [
      {
        id: 18,
        abilities: [
          { slot: 3, abilityId: E },
          { slot: 1, abilityId: Q },
          { slot: 2, abilityId: W },
          { slot: 4, abilityId: 6251 },
          { slot: 6, abilityId: R },
          { slot: 7, abilityId: 1234 },
          { slot: 8, abilityId: 55 },
        ],
        talents: [0, 1, 2, 3, 5, 6, 7].map((slot) => ({
          slot,
          abilityId: 10 + slot,
        })),
      },
    ],
    abilities: [
      {
        id: Q,
        name: "sven_storm_bolt",
        language: { displayName: "Storm Hammer" },
        stat: { maxLevel: 4 },
      },
      {
        id: W,
        name: "sven_great_cleave",
        language: { displayName: "Great Cleave" },
        stat: { maxLevel: 4 },
      },
      {
        id: E,
        name: "sven_warcry",
        language: { displayName: "Warcry" },
        stat: { maxLevel: 4 },
      },
      {
        id: 6251,
        name: "generic_hidden",
        language: { displayName: null },
        stat: { maxLevel: 0 },
      },
      {
        id: R,
        name: "sven_gods_strength",
        language: { displayName: "God's Strength" },
        stat: { maxLevel: 3, isUltimate: true },
      },
      {
        id: 1234,
        name: "sven_wrath_of_god",
        language: { displayName: "Wrath of God" },
        stat: { maxLevel: 1, isGrantedByScepter: true },
      },
      {
        id: 55,
        name: "sven_innate",
        language: { displayName: "Vanquisher" },
        stat: { maxLevel: 1, isInnate: true },
      },
      {
        id: 10,
        name: "special_bonus_mp_regen_2",
        language: { displayName: " +2  Mana Regen" },
      },
    ],
  };

  it("keeps learnable abilities in slot order and talents by tier", () => {
    const hero = toHeroAbilities(constants)[18]!;
    expect(hero.abilities.map((a) => a.name)).toEqual(["Storm Hammer", "Great Cleave", "Warcry", "God's Strength"]);
    expect(hero.abilities[3]).toMatchObject({ ultimate: true, maxLevel: 3 });
    expect(hero.talents.map((pair) => pair.map((t) => t.id))).toEqual([[10, 11], [12, 13], [15], [16, 17]]);
    expect(hero.talents[0]![0]!.name).toBe("+2 Mana Regen");
  });

  it("finds the first game version of a patch, letters included", () => {
    expect(patchGameVersion(constants.gameVersions, "7.39")).toBe(181);
    expect(patchGameVersion(constants.gameVersions, "7.40")).toBeNull();
  });
});
