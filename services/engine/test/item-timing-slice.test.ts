import { describe, expect, it } from "vitest";
import { MIN_SLICE_GAMES, THIN_SLICE_MIN_ITEMS, chooseTimingSlice, finishedItems } from "../src/engine/item-timing-slice";
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

  it("keeps a part bought long before the item built from it (Slark's Diffusal Blade at 14, Disperser at 38)", () => {
    const slark: Record<string, ItemInfo> = { 174: item("diffusal_blade"), 1097: item("disperser", [174]), 108: item("ultimate_scepter") };
    const slice: ItemTimingSlice = { games: 500, items: [[174, 14, 15], [108, 25, 26], [1097, 38, 47]] };
    expect(finishedItems(slice, slark).map(([id]) => id)).toEqual([174, 108, 1097]);
  });

  it("drops parts of parts, like Dagon under Dagon 3 when Dagon 2 is not in the slice", () => {
    const dagons: Record<string, ItemInfo> = { 104: item("dagon"), 201: item("dagon_2", [104]), 202: item("dagon_3", [201]) };
    expect(finishedItems({ games: 500, items: [[104, 22, 24], [202, 25, 28]] }, dagons).map(([id]) => id)).toEqual([202]);
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

  it("uses a thin slice when no slice is full, and the rank group only with as many items", () => {
    // Battle Fury, Manta Style (Yasha is its part), Butterfly and Black King Bar: four finished items,
    // a short list like carry Vengeful Spirit's five.
    const thin = { games: 12486, items: FULL.filter(([id]) => [145, 170, 147, 139, 116].includes(id)) };
    expect(finishedItems(thin, ITEMS)).toHaveLength(4);
    expect(chooseTimingSlice(snapshot({ all: thin }), 1, 1, 5)).toEqual({ source: "all", slice: thin });
    expect(chooseTimingSlice(snapshot({ 3: thin, all: thin }), 1, 1, 5)?.source).toBe("rank");
    // Five finished items for every rank beat the rank group's four.
    const fuller = { games: 90000, items: FULL.filter(([id]) => id !== 208) };
    expect(chooseTimingSlice(snapshot({ 3: thin, all: fuller }), 1, 1, 5)).toEqual({ source: "all", slice: fuller });
    // A full slice for every rank beats a thin rank group.
    expect(chooseTimingSlice(snapshot({ 3: thin, all }), 1, 1, 5)).toEqual({ source: "all", slice: all });
  });

  it("uses a slice with a single finished item rather than the rough list, and none with no items", () => {
    // Yasha is part of Manta Style: one finished item, like a position few players play the hero in.
    const one = { games: 900, items: FULL.filter(([id]) => [170, 147].includes(id)) };
    expect(finishedItems(one, ITEMS)).toHaveLength(THIN_SLICE_MIN_ITEMS);
    expect(chooseTimingSlice(snapshot({ all: one }), 1, 1)).toEqual({ source: "all", slice: one });
    expect(chooseTimingSlice(snapshot({ all: { games: 900, items: [] } }), 1, 1)).toBeNull();
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
