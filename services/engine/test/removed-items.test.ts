import { describe, expect, it } from "vitest";
import { dropRemovedItems, patchAtLeast, removedItemIds } from "../src/data/removed-items";
import type { ItemInfo, Snapshot } from "../src/engine/types";

const item = (key: string): ItemInfo => ({ key, name: key, cost: 1000, img: "", components: [] });
const HOTO = 635;
const BKB = 116;
const JAVELIN = 7;

function snapshot(patch: string): Snapshot {
  return {
    generatedAt: "",
    heroes: {},
    bracketStats: {},
    matchups: {},
    synergy: {},
    laneRoles: {},
    patch: { name: patch, startedAt: "2026-11-18T21:28:07.019Z" },
    items: { [HOTO]: item("helm_of_the_overlord"), [BKB]: item("black_king_bar"), [JAVELIN]: item("javelin") },
    itemBuilds: { "38": { start: {}, early: { [JAVELIN]: 20 }, mid: { [HOTO]: 77, [BKB]: 50 }, late: {} } },
    itemTimings: {
      "38": {
        "3": {
          all: {
            games: 5000,
            items: [[HOTO, 21, 25], [BKB, 24, 28]],
            lane: [[JAVELIN, 9]],
            shares: [[HOTO, 3000], [BKB, 2000]],
            pace: { itemId: HOTO, minutes: [[20, 100, 60]] },
          },
        },
      },
    },
    itemStarts: { "38": { "3": { games: 100, start: [[JAVELIN, 1]], boots: [[BKB, 10, 0.5]] } } },
    skillBuilds: {
      "38": {
        "3": {
          at: "",
          gameVersionId: 184,
          matches: 50,
          build: { levels: [], groupMatches: 0, share: 0, exactMatches: 0 },
          talents: [],
          itemPaths: {
            [HOTO]: { late: 25, running: 30, onTime: 20 },
            [BKB]: { late: 28, running: 30, onTime: 20, path: { games: 10, steps: [[HOTO, 30, 6]], keyLater: 4 } },
          },
        },
      },
    },
  } as unknown as Snapshot; // Only the item parts matter here.
}

describe("patchAtLeast", () => {
  it("compares patch numbers, not text", () => {
    expect(patchAtLeast("7.42", "7.42")).toBe(true);
    expect(patchAtLeast("7.43", "7.42")).toBe(true);
    expect(patchAtLeast("7.41", "7.42")).toBe(false);
    expect(patchAtLeast("7.100", "7.99")).toBe(true);
    expect(patchAtLeast("8.0", "7.42")).toBe(true);
  });
});

describe("dropRemovedItems", () => {
  it("keeps every item before the patch that removed it", () => {
    const s = snapshot("7.41");
    expect(removedItemIds(s).size).toBe(0);
    expect(dropRemovedItems(s)).toEqual([]);
    expect(s.items?.[HOTO]).toBeDefined();
  });

  it("drops removed items from every item source on 7.42 and later", () => {
    const s = snapshot("7.42");
    expect(dropRemovedItems(s)).toEqual([JAVELIN, HOTO]);

    expect(Object.keys(s.items ?? {})).toEqual([String(BKB)]);
    expect(s.itemBuilds?.["38"]).toEqual({ start: {}, early: {}, mid: { [BKB]: 50 }, late: {} });
    const slice = s.itemTimings?.["38"]?.["3"]?.all;
    expect(slice?.items).toEqual([[BKB, 24, 28]]);
    expect(slice?.lane).toEqual([]);
    expect(slice?.shares).toEqual([[BKB, 2000]]);
    expect(slice?.pace).toBeUndefined();
    expect(s.itemStarts?.["38"]?.["3"]).toMatchObject({ start: [], boots: [[BKB, 10, 0.5]] });
    const paths = s.skillBuilds?.["38"]?.["3"]?.itemPaths;
    expect(Object.keys(paths ?? {})).toEqual([String(BKB)]);
    expect(paths?.[BKB]?.path).toBeUndefined();
  });

  it("is safe to run twice", () => {
    const s = snapshot("7.43");
    dropRemovedItems(s);
    expect(dropRemovedItems(s)).toEqual([]);
  });

  it("drops timings of a removed item whose list entry is already gone", () => {
    // The item list is refreshed on its own day; STRATZ timings can still hold the item after it.
    const s = snapshot("7.42");
    delete s.items?.[HOTO];
    expect(dropRemovedItems(s)).toContain(HOTO);
    expect(s.itemTimings?.["38"]?.["3"]?.all?.items).toEqual([[BKB, 24, 28]]);
  });
});
