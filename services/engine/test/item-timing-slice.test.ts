import { describe, expect, it } from "vitest";
import { MIN_SLICE_GAMES, chooseTimingSlice, finishedItems } from "../src/engine/item-timing-slice";
import type { ItemInfo, ItemTimingSlice, Snapshot } from "../src/engine/types";

const item = (key: string, components: number[] = []): ItemInfo => ({ key, name: key, cost: 3000, img: "", components });
// Anti-Mage's usual core with real item ids; Yasha (170) is part of Manta Style (147).
const ITEMS: Record<string, ItemInfo> = {
  145: item("bfury"),
  170: item("yasha"),
  147: item("manta", [170]),
  143: item("basher"),
  139: item("butterfly"),
  160: item("skadi"),
  208: item("abyssal_blade", [143]),
  116: item("black_king_bar"),
};
const FULL: ItemTimingSlice["items"] = [
  [145, 15, 16],
  [170, 18, 19],
  [147, 22, 23],
  [139, 30, 31],
  [160, 33, 37],
  [116, 35, 39],
  [208, 37, 41],
];

const snapshot = (slices: Record<string, ItemTimingSlice>): Snapshot => ({
  generatedAt: "",
  heroes: {},
  bracketStats: {},
  matchups: {},
  synergy: {},
  laneRoles: {},
  items: ITEMS,
  itemTimings: { 1: { 1: slices } },
});

describe("finishedItems", () => {
  it("drops items that another item in the slice is built from", () => {
    expect(finishedItems({ games: 500, items: FULL }, ITEMS).map(([id]) => id)).toEqual([145, 147, 139, 160, 116, 208]);
  });
});

describe("chooseTimingSlice", () => {
  const all: ItemTimingSlice = { games: 90000, items: FULL };

  it("uses the player's rank group at exactly the game minimum", () => {
    const own = { games: MIN_SLICE_GAMES, items: FULL };
    // Legend (5) is in rank group 3.
    expect(chooseTimingSlice(snapshot({ 3: own, all }), 1, 1, 5)).toEqual({ source: "rank", slice: own });
  });

  it("falls back to every rank one game under the minimum", () => {
    const own = { games: MIN_SLICE_GAMES - 1, items: FULL };
    expect(chooseTimingSlice(snapshot({ 3: own, all }), 1, 1, 5)).toEqual({ source: "all", slice: all });
  });

  it("falls back to every rank when the rank group has enough games but too few finished items", () => {
    // Seven items, but Yasha is part of Manta Style and Butterfly is gone: five finished items.
    const own = { games: 5000, items: FULL.filter(([id]) => id !== 139) };
    expect(chooseTimingSlice(snapshot({ 3: own, all }), 1, 1, 5)?.source).toBe("all");
  });

  it("uses every rank when the player's rank is unknown or its slice is missing", () => {
    expect(chooseTimingSlice(snapshot({ all }), 1, 1)?.source).toBe("all");
    expect(chooseTimingSlice(snapshot({ all }), 1, 1, 8)?.source).toBe("all");
  });

  it("is null when no slice is good enough, or there is no data for the hero or position", () => {
    expect(chooseTimingSlice(snapshot({ all: { games: 150, items: FULL } }), 1, 1)).toBeNull();
    expect(chooseTimingSlice(snapshot({ all }), 1, 2)).toBeNull();
    expect(chooseTimingSlice(snapshot({ all }), 2, 1)).toBeNull();
    expect(chooseTimingSlice({ ...snapshot({ all }), itemTimings: undefined }, 1, 1)).toBeNull();
  });
});
