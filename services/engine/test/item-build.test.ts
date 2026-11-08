import { describe, expect, it } from "vitest";
import { itemBuild, listNames, sharesBuiltPart, threatsOf, withoutAlternatives } from "../src/engine/item-build";
import type { HeroInfo, ItemInfo, Snapshot } from "../src/engine/types";

const hero = (id: number, name: string, roles: string[]): HeroInfo => ({ id, name, roles, attackType: "Melee", primaryAttr: "str" });
const item = (key: string, name: string, cost: number, components: number[] = []): ItemInfo => ({ key, name, cost, img: `/${key}.png`, components });

/** A carry who buys boots, a wand, Armlet, Radiance and sometimes BKB, against a lineup of stunners. */
function data(): Snapshot {
  const heroes = [
    hero(1, "Wraith King", ["Carry", "Durable", "Disabler"]),
    hero(2, "Lion", ["Support", "Disabler", "Nuker"]),
    hero(3, "Earthshaker", ["Initiator", "Disabler"]),
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

  it("names the stunners BKB answers and keeps it where players buy it", () => {
    const build = itemBuild(data(), 1, 1, [2, 3, 6, 4, 5])!;
    expect(build.core.map((i) => i.name)).toEqual(["Phase Boots", "Armlet of Mordiggian", "Radiance", "Black King Bar"]);
    expect(build.core[3]!.reason).toBe("Against Lion, Earthshaker and Crystal Maiden: don't skip it");
    expect(build.core[3]!.against?.map((id) => data().heroes[id]?.name)).toEqual(["Lion", "Earthshaker", "Crystal Maiden"]);
  });

  it("doesn't count stunners whose lock goes through Black King Bar", () => {
    const base = data();
    const enigma = hero(33, "Enigma", ["Disabler", "Initiator", "Pusher"]);
    const withEnigma = { ...base, heroes: { ...base.heroes, 3: { ...enigma, id: 3 } } };
    const build = itemBuild(withEnigma, 1, 1, [2, 3, 6])!;
    // Lion and Crystal Maiden are two stunners, under the three Black King Bar needs; Black Hole goes through it.
    expect(build.core[3]!.reason).toBeUndefined();
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
    expect(build.situational.map((i) => [i.name, i.reason, i.against])).toEqual([["Monkey King Bar", "Against Phantom Assassin", [7]]]);
    expect(itemBuild(d, 1, 5, [7])!.situational).toEqual([]);
  });

  it("buys a counter item instead of the nearest usual item that answers nothing", () => {
    const d = data();
    d.items![200] = item("desolator", "Desolator", 3500);
    d.items![201] = item("blink", "Blink Dagger", 2250);
    d.itemBuilds![1]!.late = { 116: 30, 200: 30, 201: 30, 145: 20 };
    d.heroes[7] = hero(7, "Phantom Assassin", ["Carry", "Escape"]);
    const mkb = itemBuild(d, 1, 1, [7])!.situational[0]!;
    // Not the boots, the first big item (Armlet) or a Blink Dagger: one of the later usual items.
    const usual = itemBuild(d, 1, 1, [7])!.core;
    const swapped = usual.find((c) => c.itemId === mkb.replaces)!;
    expect(["Radiance", "Black King Bar", "Desolator"]).toContain(swapped.name);
    expect(mkb).toMatchObject({ draft: true, phase: "late" });
  });

  it("puts every item on a step of the path", () => {
    const build = itemBuild(data(), 1, 1, [4])!;
    expect(build.start.every((i) => i.phase === "start")).toBe(true);
    expect(build.lane.every((i) => i.phase === "lane")).toBe(true);
    // Boots go with the lane, then the first big item, then the rest by minute.
    expect(build.core.map((i) => [i.name, i.phase])).toEqual([
      ["Phase Boots", "lane"],
      ["Armlet of Mordiggian", "first"],
      ["Radiance", "next"],
      ["Black King Bar", "late"],
    ]);
    expect(build.core.every((i) => !i.draft)).toBe(true);
  });
});

describe("itemBuild with STRATZ item timings", () => {
  /** Wraith King data plus timings for pos 1: a rank group 3 slice and an every-rank slice. */
  function timed(): Snapshot {
    const d = data();
    d.items![200] = item("desolator", "Desolator", 3500);
    d.items![201] = item("blink", "Blink Dagger", 2250);
    d.items![202] = item("assault", "Assault Cuirass", 5125);
    d.items![203] = item("ogre_axe", "Ogre Axe", 1000);
    d.items![116] = item("black_king_bar", "Black King Bar", 4050, [203]);
    const slice = (bkbMinute: number) => ({
      games: 5000,
      items: [
        [151, 12, 14], [137, 17, 19], [116, bkbMinute, bkbMinute + 3], [200, 24, 27], [201, 26, 30], [202, 31, 35], [145, 34, 38],
      ] as [number, number, number][],
    });
    d.itemTimings = { 1: { 1: { 3: slice(20), all: slice(22) } } };
    return d;
  }

  it("takes the core and its minutes from the slice, keeping OpenDota's boots", () => {
    const build = itemBuild(timed(), 1, 1, [4])!;
    expect(build.timings).toBe("all");
    expect(build.core.map((i) => [i.name, i.minute, i.lateMinute])).toEqual([
      ["Phase Boots", 8, undefined],
      ["Armlet of Mordiggian", 12, 14],
      ["Radiance", 17, 19],
      ["Black King Bar", 22, 25],
      ["Desolator", 24, 27],
      ["Blink Dagger", 26, 30],
    ]);
  });

  it("takes the start, its copies and the boots with their minute from STRATZ", () => {
    const d = timed();
    d.itemStarts = { 1: { 1: { games: 1000, start: [[44, 1], [16, 2]], boots: [[63, 7, 0.6], [50, 8, 0.25]] } } };
    const build = itemBuild(d, 1, 1, [4])!;
    expect(build.start.map((i) => [i.name, i.count])).toEqual([
      ["Tango", undefined],
      ["Iron Branch", 2],
    ]);
    // Power Treads replaces OpenDota's Phase Boots, at STRATZ's minute; Phase Boots is the "or".
    expect(build.core[0]).toMatchObject({ name: "Power Treads", minute: 7 });
    expect(build.core.filter((i) => i.name === "Phase Boots")).toEqual([]);
    expect(build.bootsOr).toMatchObject({ name: "Phase Boots", minute: 8 });
    // A lane item already in the start is not bought twice.
    d.itemStarts[1]![1]!.start.push([36, 1]);
    expect(itemBuild(d, 1, 1, [4])!.lane.map((i) => i.name)).toEqual([]);
    // Another position has no STRATZ start: OpenDota's is kept.
    expect(itemBuild(d, 1, 2, [4])!.bootsOr).toBeUndefined();
  });

  it("takes the lane items and their minutes from the slice, in buy order", () => {
    const d = timed();
    d.items![181] = item("orb_of_venom", "Orb of Venom", 275);
    d.itemTimings![1]![1]!.all!.lane = [[181, 2], [36, 4]];
    expect(itemBuild(d, 1, 1, [4])!.lane.map((i) => [i.name, i.minute])).toEqual([
      ["Orb of Venom", 2],
      ["Magic Wand", 4],
    ]);
    // A slice without lane items (an older snapshot) keeps OpenDota's.
    expect(itemBuild(timed(), 1, 1, [4])!.lane.map((i) => i.name)).toEqual(["Magic Wand"]);
  });

  it("uses the player's rank group when it has enough data", () => {
    const build = itemBuild(timed(), 1, 1, [4], 5)!;
    expect(build.timings).toBe("rank");
    expect(build.core.find((i) => i.name === "Black King Bar")?.minute).toBe(20);
  });

  it("keeps a counter item's real minutes instead of moving it earlier", () => {
    const build = itemBuild(timed(), 1, 1, [2, 3, 6, 4, 5])!;
    expect(build.core[3]).toMatchObject({ name: "Black King Bar", minute: 22, lateMinute: 25 });
    expect(build.core[3]!.reason).toContain("don't skip it");
  });

  it("buys items one after another, so two items never share a minute", () => {
    const d = timed();
    d.itemTimings![1]![1]!.all!.items[1] = [137, 12, 13];
    const build = itemBuild(d, 1, 1, [4])!;
    expect(build.core.slice(1, 3).map((i) => [i.name, i.minute, i.lateMinute])).toEqual([
      ["Armlet of Mordiggian", 12, 14],
      ["Radiance", 13, undefined],
    ]);
  });

  it("falls back to rough minutes without timings for the position", () => {
    const build = itemBuild(timed(), 1, 3, [4])!;
    expect(build.timings).toBe("around");
    expect(build.core.every((i) => i.lateMinute === undefined)).toBe(true);
  });
});

describe("items built from the same part", () => {
  /** Yasha (built) in Manta Style and Sange and Yasha; Sange (built) in Sange and Yasha and Abyssal Blade. */
  function withYasha(): Snapshot {
    const d = data();
    d.items![300] = item("blade_of_alacrity", "Blade of Alacrity", 1000);
    d.items![301] = item("yasha", "Yasha", 2100, [300]);
    d.items![302] = item("ogre_axe", "Ogre Axe", 1000);
    d.items![303] = item("sange", "Sange", 2100, [302]);
    d.items![147] = item("manta", "Manta Style", 4650, [301]);
    d.items![154] = item("sange_and_yasha", "Sange and Yasha", 4200, [301, 303]);
    d.items![208] = item("abyssal_blade", "Abyssal Blade", 6250, [303]);
    d.items![202] = item("assault", "Assault Cuirass", 5125);
    d.items![200] = item("desolator", "Desolator", 3500);
    return d;
  }
  // Every fixture here has item builds for hero 1, so there is a build.
  const core = (d: Snapshot) => itemBuild(d, 1, 1, [])!.core.map((i) => i.name);
  const byMinute = ([id, minute]: [number, number]) => ({ id, minute });
  const timings = (rows: [number, number, number][]) => ({ 1: { 1: { all: { games: 5000, items: rows } } } });

  it("keeps only the more bought of two items made from one Yasha at about the same minute", () => {
    const d = withYasha();
    // Most bought first, as STRATZ's slices are: Manta Style at 20, then Sange and Yasha at 21.
    d.itemTimings = timings([[151, 12, 14], [137, 17, 19], [147, 20, 24], [154, 21, 28], [116, 23, 26], [200, 26, 30], [202, 31, 35]]);
    expect(core(d)).toContain("Manta Style");
    expect(core(d)).not.toContain("Sange and Yasha");
    // The freed slot goes to the next item.
    expect(core(d)).toContain("Desolator");
  });

  it("does the same with OpenDota's rough minutes", () => {
    const d = withYasha();
    d.itemBuilds![1] = { start: {}, early: { 50: 100 }, mid: { 151: 60, 147: 50, 154: 30, 137: 40 }, late: { 116: 30 } };
    expect(core(d)).toContain("Manta Style");
    expect(core(d)).not.toContain("Sange and Yasha");
  });

  it("keeps two items from one part bought far apart: players buy both", () => {
    const d = withYasha();
    const both: [number, number][] = [[154, 25], [208, 39]];
    expect(withoutAlternatives(both, byMinute, d.items!)).toEqual(both);
    // Six minutes apart is far enough; five isn't.
    const six: [number, number][] = [[147, 20], [154, 26]];
    expect(withoutAlternatives(six, byMinute, d.items!)).toEqual(six);
    const five: [number, number][] = [[147, 20], [154, 25], [200, 22]];
    expect(withoutAlternatives(five, byMinute, d.items!)).toEqual([[147, 20], [200, 22]]);
  });

  it("counts only a built part over the core cost, not a basic one", () => {
    const d = withYasha();
    expect(sharesBuiltPart(147, 154, d.items!)).toBe(true);
    // Ogre Axe is a basic item: Sange and Black King Bar are not alternatives through it.
    d.items![116] = item("black_king_bar", "Black King Bar", 4050, [302]);
    expect(sharesBuiltPart(303, 116, d.items!)).toBe(false);
    // Perseverance is built but costs 1400: Battle Fury and Linken's Sphere are not alternatives through it.
    d.items![310] = item("ring_of_health", "Ring of Health", 700);
    d.items![311] = item("pers", "Perseverance", 1400, [310]);
    d.items![312] = item("bfury", "Battle Fury", 4100, [311]);
    d.items![313] = item("sphere", "Linken's Sphere", 4800, [311]);
    expect(sharesBuiltPart(312, 313, d.items!)).toBe(false);
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
