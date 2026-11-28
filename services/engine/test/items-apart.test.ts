import { describe, expect, it } from "vitest";
import { findItemsApart, MIN_GAMES, upgradesOf } from "../src/data/items-apart";
import type { EvalMatch } from "../src/data/eval-matches";
import type { ItemInfo } from "../src/engine/types";

const item = (key: string, cost: number, components: number[] = []): ItemInfo => ({ key, name: key, cost, img: "", components });
const ITEMS: Record<string, ItemInfo> = {
  166: item("maelstrom", 2950),
  158: item("mjollnir", 5500, [166]),
  168: item("desolator", 3500),
  116: item("black_king_bar", 4050),
  63: item("power_treads", 1400),
  609: item("aghanims_shard", 1400),
};
const PATCH = 1_000_000;

/** `n` games of Weaver (63) carry, each ending with `items`; `buys` adds parsed purchases. */
function games(n: number, items: number[], buys: [number, number][] = [], startTime = PATCH + 10): EvalMatch[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i,
    startTime,
    rankTier: 55,
    radiantWin: true,
    bans: [],
    picks: [{ heroId: 63, radiant: true, position: 1 as const, items, ...(buys.length ? { buys } : {}) }],
  }));
}

describe("upgradesOf", () => {
  it("holds an item and everything built from it", () => {
    expect([...upgradesOf(ITEMS).get(166)!].sort()).toEqual([158, 166]);
  });
});

describe("findItemsApart", () => {
  it("finds two routes and counts an upgrade as holding its part", () => {
    // 30 Desolator only, 20 Mjollnir only (holds Maelstrom), 5 with both; BKB in every game.
    const all = [...games(30, [63, 168, 116]), ...games(20, [63, 158, 116]), ...games(5, [63, 168, 166, 116])];
    const apart = findItemsApart(all, ITEMS, PATCH);
    // 5 of 55 games with either held both: 9%. Desolator and Mjollnir itself: never together.
    expect(apart["63"]?.["1"]).toEqual([[168, 166, 9], [168, 158, 0]]);
  });

  it("counts parsed purchases as held, skips boots and the Shard, and needs enough games", () => {
    // Desolator and Maelstrom bought (then sold) in the same 30 games: held together, so one route.
    const sold = [...games(30, [63, 116], [[168, 15], [166, 18], [609, 20]]), ...games(20, [63, 158, 116])];
    const pairs = findItemsApart(sold, ITEMS, PATCH)["63"]?.["1"] ?? [];
    expect(pairs.some(([a, b]) => [a, b].includes(168) && [a, b].includes(166))).toBe(false);
    expect(pairs.flat().some((id) => id === 63 || id === 609)).toBe(false);
    expect(findItemsApart(games(MIN_GAMES - 1, [168]).concat(games(1, [166])).slice(0, MIN_GAMES - 1), ITEMS, PATCH)).toEqual({});
  });

  it("leaves out games from before the patch", () => {
    expect(findItemsApart([...games(30, [168], [], PATCH - 1), ...games(30, [166], [], PATCH - 1)], ITEMS, PATCH)).toEqual({});
  });
});
