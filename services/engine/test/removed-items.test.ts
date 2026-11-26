import { describe, expect, it } from "vitest";
import { dropRemovedItems, fetchRemovedItems, obsoleteItemIds, removedItemIds } from "../src/data/removed-items";
import { parseKV } from "../src/data/talent-texts";
import type { ItemInfo, Snapshot } from "../src/engine/types";

const item = (key: string): ItemInfo => ({ key, name: key, cost: 1000, img: "", components: [] });
const HOTO = 635;
const BKB = 116;
const JAVELIN = 7;

function snapshot(removedItems?: number[]): Snapshot {
  return {
    generatedAt: "",
    heroes: {},
    bracketStats: {},
    matchups: {},
    synergy: {},
    laneRoles: {},
    removedItems,
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

// The game's item file after 7.42: removed items keep their block, marked obsolete.
const ITEMS = `"DOTAAbilities"
{
  "Version" "1"
  "item_javelin" { "ItemCost" "900" "IsObsolete" "1" }
  "item_recipe_helm_of_the_overlord" { "IsObsolete" "1" }
  "item_helm_of_the_overlord" { "ItemPurchasable" "0" "IsObsolete" "1" }
  "item_recipe_medallion_of_courage" { "IsObsolete" "1" }
  "item_black_king_bar" { "ItemCost" "4050" }
  "item_not_in_ids" { "IsObsolete" "1" }
}`;
const IDS = `"DOTAAbilityIDs" { "ItemAbilities" { "Locked" {
  "item_javelin" "7" "item_recipe_helm_of_the_overlord" "634" "item_helm_of_the_overlord" "635"
  "item_recipe_medallion_of_courage" "186" "item_black_king_bar" "116"
} } }`;

describe("removed items from the game files", () => {
  it("takes the obsolete items by id, not their recipes", () => {
    expect(obsoleteItemIds(parseKV(ITEMS), parseKV(IDS))).toEqual([JAVELIN, HOTO]);
  });

  it("refuses a list that looks cut short", async () => {
    const getText = async (url: string) => (url.endsWith("items.txt") ? ITEMS : IDS);
    await expect(fetchRemovedItems(getText)).rejects.toThrow("only 2 removed items");
  });
});

describe("dropRemovedItems", () => {
  it("keeps every item before any are known to be removed", () => {
    const s = snapshot();
    expect(removedItemIds(s).size).toBe(0);
    expect(dropRemovedItems(s)).toEqual([]);
    expect(s.items?.[HOTO]).toBeDefined();
  });

  it("drops removed items from every item source", () => {
    const s = snapshot([JAVELIN, HOTO]);
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
    const s = snapshot([JAVELIN, HOTO]);
    dropRemovedItems(s);
    expect(dropRemovedItems(s)).toEqual([]);
  });

  it("drops timings of a removed item whose list entry is already gone", () => {
    // The item list is refreshed on its own day; STRATZ timings can still hold the item after it.
    const s = snapshot([JAVELIN, HOTO]);
    delete s.items?.[HOTO];
    expect(dropRemovedItems(s)).toContain(HOTO);
    expect(s.itemTimings?.["38"]?.["3"]?.all?.items).toEqual([[BKB, 24, 28]]);
  });
});
