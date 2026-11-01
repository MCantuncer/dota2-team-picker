import { describe, expect, it } from "vitest";
import { itemBuild, listNames, threatsOf } from "../src/engine/item-build";
import type { HeroInfo, ItemInfo, Snapshot } from "../src/engine/types";

const hero = (id: number, name: string, roles: string[]): HeroInfo => ({ id, name, roles, attackType: "Melee", primaryAttr: "str" });
const item = (key: string, name: string, cost: number, components: number[] = []): ItemInfo => ({ key, name, cost, img: `/${key}.png`, components });

/** A carry who buys boots, a wand, Armlet, Radiance and sometimes BKB, against a lineup of stunners. */
function data(): Snapshot {
  const heroes = [
    hero(1, "Wraith King", ["Carry", "Durable", "Disabler"]),
    hero(2, "Lion", ["Support", "Disabler", "Nuker"]),
    hero(3, "Primal Beast", ["Initiator", "Disabler"]),
    hero(4, "Lich", ["Support", "Nuker"]),
    hero(5, "Lifestealer", ["Carry", "Durable"]),
    hero(6, "Crystal Maiden", ["Support", "Disabler", "Nuker"]),
  ];
  return {
    generatedAt: "",
    heroes: Object.fromEntries(heroes.map((h) => [h.id, h])),
    bracketStats: {},
    matchups: {},
    synergy: {},
    laneRoles: {},
    items: {
      1: item("boots", "Boots of Speed", 500),
      16: item("branches", "Iron Branch", 50),
      44: item("tango", "Tango", 90),
      36: item("magic_wand", "Magic Wand", 450),
      50: item("phase_boots", "Phase Boots", 1500, [1]),
      63: item("power_treads", "Power Treads", 1400, [1]),
      116: item("black_king_bar", "Black King Bar", 4050),
      137: item("radiance", "Radiance", 4700),
      151: item("armlet", "Armlet of Mordiggian", 2500),
      145: item("monkey_king_bar", "Monkey King Bar", 4975),
      267: item("spirit_vessel", "Spirit Vessel", 2780),
    },
    itemBuilds: {
      1: {
        start: { 16: 90, 44: 80 },
        early: { 1: 100, 50: 70, 63: 20, 36: 60 },
        mid: { 151: 60, 137: 50, 267: 4 },
        late: { 116: 30 },
      },
    },
  };
}

describe("itemBuild", () => {
  it("returns null without item data", () => {
    expect(itemBuild({ ...data(), itemBuilds: undefined }, 1, 1, [])).toBeNull();
  });

  it("gives the usual build in buying order, one pair of boots, without components", () => {
    const build = itemBuild(data(), 1, 1, [4])!;
    expect(build.start.map((i) => i.name)).toEqual(["Iron Branch", "Tango"]);
    expect(build.lane.map((i) => i.name)).toEqual(["Magic Wand"]);
    expect(build.core.map((i) => i.name)).toEqual(["Phase Boots", "Armlet of Mordiggian", "Radiance", "Black King Bar"]);
    expect(build.core.every((i) => i.reason === undefined)).toBe(true);
  });

  it("moves BKB up against three stunners and names them", () => {
    const build = itemBuild(data(), 1, 1, [2, 3, 6, 4, 5])!;
    expect(build.core.map((i) => i.name)).toEqual(["Phase Boots", "Black King Bar", "Armlet of Mordiggian", "Radiance"]);
    expect(build.core[1]!.reason).toBe("Against Lion, Primal Beast and Crystal Maiden: buy it early");
  });

  it("never adds an item players do not buy on the hero", () => {
    // Spirit Vessel answers Lifestealer's healing, but it is under 10% of the hero's most bought item.
    const build = itemBuild(data(), 1, 1, [5, 4])!;
    expect(build.situational).toEqual([]);
  });

  it("adds a bought counter item outside the core as situational, and only for the right role", () => {
    const d = data();
    // Six bigger items fill the core, so Monkey King Bar can only be situational.
    d.items![200] = item("desolator", "Desolator", 3500);
    d.items![201] = item("blink", "Blink Dagger", 2250);
    d.itemBuilds![1]!.late = { 116: 30, 200: 30, 201: 30, 145: 20 };
    d.heroes[7] = hero(7, "Phantom Assassin", ["Carry", "Escape"]);
    const build = itemBuild(d, 1, 1, [7])!;
    expect(build.core).toHaveLength(6);
    expect(build.situational.map((i) => [i.name, i.reason])).toEqual([["Monkey King Bar", "Against Phantom Assassin"]]);
    expect(itemBuild(d, 1, 5, [7])!.situational).toEqual([]);
  });
});

describe("threatsOf", () => {
  it("reads disables and nukes from roles and the rest from the hand-kept lists", () => {
    expect([...threatsOf(hero(5, "Lifestealer", ["Carry", "Durable"]))].sort()).toEqual(["heal", "passives", "physicalCarry"]);
    expect([...threatsOf(hero(2, "Lion", ["Support", "Disabler", "Nuker"]))].sort()).toEqual(["disable", "magicBurst"]);
  });
});

describe("listNames", () => {
  it("joins names in plain English", () => {
    expect(listNames(["Lion"])).toBe("Lion");
    expect(listNames(["Lion", "Lich"])).toBe("Lion and Lich");
    expect(listNames(["Lion", "Lich", "Slark"])).toBe("Lion, Lich and Slark");
  });
});
