import { describe, expect, it } from "vitest";
import type { ItemGame } from "../src/engine/item-odds";
import { fallbackQuestion, slotQuestions } from "../src/engine/item-questions";
import { drawSets } from "../scripts/item-odds-report";
import { seeded } from "../src/engine/item-odds";

// Ids under 10 are big items; costs by id.
const isBig = (id: number) => id < 10;
const COST: Record<number, number> = { 1: 1400, 2: 1500, 3: 4700, 4: 2000, 5: 3000 };
const cost = (id: number) => COST[id];

function game(items: [number, number][], lead = Array.from({ length: 40 }, () => 0)): ItemGame {
  return { match: 1, account: 1, won: true, level: 25, version: 190, points: [], items, duration: 40 * 60, lead };
}

describe("slotQuestions", () => {
  it("takes A as the most bought item at the slot and B as the next one of a similar cost", () => {
    const games = [
      ...Array.from({ length: 5 }, () => game([[1, 10 * 60], [5, 20 * 60]])),
      ...Array.from({ length: 3 }, () => game([[2, 10 * 60], [4, 21 * 60]])),
      ...Array.from({ length: 4 }, () => game([[3, 10 * 60], [5, 21 * 60]])),
    ];
    const qs = slotQuestions(games, isBig, cost);
    // Slot 1: Radiance (3, 4700) is too dear against item 1 (1400), so B is item 2.
    expect(qs.map(({ slot, minute, a, b }) => ({ slot, minute, a, b }))).toEqual([
      { slot: 1, minute: 7, a: 1, b: 2 },
      { slot: 2, minute: 18, a: 5, b: 4 },
    ]);
  });
  it("leaves out games without a lead and asks nothing without a second item", () => {
    const games = [game([[1, 600]]), game([[2, 600]], [])];
    expect(slotQuestions(games, isBig, cost)).toEqual([]);
  });
});

describe("fallbackQuestion", () => {
  it("asks about the key item once it is late", () => {
    const q = fallbackQuestion({ itemId: 3, lateMinute: 20.6 }, isBig);
    expect([q?.kind, q?.kind === "fallback" ? q.key : 0, q?.minute]).toEqual(["fallback", 3, 21]);
  });
  it("asks nothing without a key item, its late minute, or a big key item", () => {
    expect(fallbackQuestion(undefined, isBig)).toBeUndefined();
    expect(fallbackQuestion({ itemId: 3 }, isBig)).toBeUndefined();
    expect(fallbackQuestion({ itemId: 50, lateMinute: 9 }, isBig)).toBeUndefined();
  });
});

describe("drawSets", () => {
  it("draws different sets of distinct entries, or none when too few", () => {
    const sets = drawSets([1, 2, 3, 4, 5, 6, 7], 5, 10, seeded(1));
    expect(sets).toHaveLength(10);
    expect(sets.every((s) => new Set(s).size === 5)).toBe(true);
    expect(new Set(sets.map((s) => s.join())).size).toBe(10);
    expect(drawSets([1, 2], 5, 3, seeded(1))).toEqual([]);
  });
  it("stops at the number of different sets there are", () => {
    expect(drawSets([1, 2, 3, 4, 5], 5, 20, seeded(1))).toHaveLength(1);
    expect(drawSets([1, 2, 3, 4, 5, 6], 5, 20, seeded(1))).toHaveLength(6);
  });
});
