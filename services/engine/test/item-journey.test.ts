import { describe, expect, it } from "vitest";
import { itemJourney } from "../src/engine/game-plan";
import type { BuildItem, ItemBuild } from "../src/engine/item-build";
import { Engine } from "../src/engine/score";
import type { ItemInfo, KeyPaths, Snapshot } from "../src/engine/types";

const item = (key: string, name: string, cost: number): ItemInfo => ({ key, name, cost, img: "", components: [] });
// 50 Phase Boots, 151 Armlet, 137 Radiance, 116 BKB, 200 Assault Cuirass.
const ITEMS: Record<string, ItemInfo> = {
  50: item("phase_boots", "Phase Boots", 1500),
  151: item("armlet", "Armlet of Mordiggian", 2500),
  137: item("radiance", "Radiance", 4700),
  116: item("black_king_bar", "Black King Bar", 4050),
  200: item("assault", "Assault Cuirass", 5125),
};
const core = (rows: [number, number][]): BuildItem[] =>
  rows.map(([itemId, minute]) => ({ itemId, name: ITEMS[itemId]?.name ?? "", img: "", minute }));
// Wraith King pos 1: Phase Boots 8, Radiance 17 (the key item), BKB 22.
const build: ItemBuild = { timings: "all", start: [], lane: [], situational: [], core: core([[50, 8], [137, 17], [116, 22]]) };

function engine(paths: Record<string, KeyPaths> | undefined): Engine {
  const snapshot: Snapshot = {
    generatedAt: "",
    heroes: { 42: { id: 42, name: "Wraith King", roles: ["Carry"], attackType: "Melee", primaryAttr: "str" } },
    bracketStats: {},
    matchups: {},
    synergy: {},
    laneRoles: {},
    items: ITEMS,
    skillBuilds: { 42: { 1: { at: "", gameVersionId: 181, matches: 58, talents: [], ...(paths ? { itemPaths: paths } : {}) } } },
  };
  return new Engine(snapshot);
}

// 58 running at 18: 44 had Radiance, 14 didn't; the late group went Phase, Armlet 17, Radiance 24, BKB 30.
const radiance: KeyPaths = {
  late: 18,
  running: 58,
  onTime: 44,
  path: { games: 14, steps: [[50, 8, 13], [151, 17, 9], [137, 24, 8], [116, 30, 7]], keyLater: 11 },
};

describe("itemJourney", () => {
  it("gives the key item's late path from where it leaves the build", () => {
    expect(itemJourney(engine({ 137: radiance }), build, 42, 1)).toEqual({
      itemId: 137,
      late: 18,
      running: 58,
      onTime: 44,
      games: 14,
      // Phase Boots at 8 is on both paths, so the late path starts at Armlet.
      steps: [[151, 17, 9], [137, 24, 8], [116, 30, 7]],
      keyLater: 11,
    });
  });

  it("is nothing without paths, without a path for the key item, or with the key's late minute not past the build's", () => {
    expect(itemJourney(engine(undefined), build, 42, 1)).toBeUndefined();
    expect(itemJourney(engine({}), build, 42, 1)).toBeUndefined();
    expect(itemJourney(engine({ 116: { ...radiance } }), build, 42, 1)).toBeUndefined();
    const { path: _, ...noPath } = radiance;
    expect(itemJourney(engine({ 137: noPath }), build, 42, 1)).toBeUndefined();
    // A build with Radiance at 19 (another rank's minutes) against a late minute of 18.
    const slow = { ...build, core: core([[50, 8], [137, 19], [116, 22]]) };
    expect(itemJourney(engine({ 137: radiance }), slow, 42, 1)).toBeUndefined();
    expect(itemJourney(engine({ 137: radiance }), null, 42, 1)).toBeUndefined();
  });

  it("is nothing when every step is one the build has before the key item", () => {
    const same: KeyPaths = { ...radiance, path: { games: 14, steps: [[50, 8, 13]], keyLater: 11 } };
    expect(itemJourney(engine({ 137: same }), build, 42, 1)).toBeUndefined();
  });
});
