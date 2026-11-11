import { describe, expect, it } from "vitest";
import type { ItemGame } from "../src/engine/item-odds";
import { flagCount, itemPatterns, MIN_MOVED_SIDE, zScore } from "../src/engine/item-patterns";
import { poolByMatch } from "../src/engine/item-problems";

const SOUL_RING = 178;
const SHADOW_BLADE = 152;
const isTracked = Object.assign((id: number) => id === SOUL_RING || id === SHADOW_BLADE, { componentsOf: () => [] });
let next = 1;
/** A game by a new player; `lead` is the team's networth lead every minute. */
const game = (won: boolean, items: [number, number][], lead = 0, minutes = 40): ItemGame => ({
  match: next++,
  account: next,
  won,
  level: 25,
  version: 1,
  points: [],
  items: items.map(([id, minute]) => [id, minute * 60]),
  duration: minutes * 60,
  lead: Array.from({ length: minutes + 1 }, () => lead),
});
const many = (n: number, make: () => ItemGame) => Array.from({ length: n }, make);
const patterns = (rows: { enemy: number; games: ItemGame[] }[]) => itemPatterns(poolByMatch(rows, isTracked));

describe("zScore", () => {
  it("can't be read for a small side or an item nearly everyone buys", () => {
    expect(zScore({ bought: 5, games: 9 }, { bought: 5, games: 50 })).toBeUndefined();
    expect(zScore({ bought: 95, games: 95 }, { bought: 87, games: 88 })).toBeUndefined();
  });

  it("grows with the gap", () => {
    expect(zScore({ bought: 40, games: 50 }, { bought: 10, games: 50 })).toBeGreaterThan(5);
    expect(zScore({ bought: 26, games: 50 }, { bought: 24, games: 50 })).toBeLessThan(1);
  });
});

describe("itemPatterns", () => {
  it("counts a lane item bought from behind that winners and losers buy alike, with no flag", () => {
    const [ring] = patterns([{
      enemy: 2,
      games: [
        ...many(20, () => game(true, [[SOUL_RING, 9]], -500)),
        ...many(20, () => game(true, [], 400)),
        ...many(20, () => game(false, [[SOUL_RING, 9]], -500)),
        ...many(20, () => game(false, [], 400)),
      ],
    }]);
    expect(ring).toMatchObject({ item: SOUL_RING, all: { bought: 40, games: 80 }, minute: 9, leadWith: -500, leadWithout: 400 });
    expect(ring?.wins).toEqual({ bought: 20, games: 40 });
    expect(ring?.winZ).toBe(0);
    // Wins and the trend could run; the one enemy has no other games to compare with.
    expect(ring?.tests).toBe(2);
    expect(ring && flagCount(ring)).toBe(0);
  });

  it("leaves games that ended before the cutoff out of wins and losses", () => {
    const [blade] = patterns([{
      enemy: 2,
      games: [...many(20, () => game(true, [[SHADOW_BLADE, 20]])), ...many(20, () => game(false, [], 0, 22))],
    }]);
    // Usual minute 20, cutoff 26: the 22 minute losses don't count, so there is nothing to compare.
    expect(blade?.losses).toEqual({ bought: 0, games: 0 });
    expect(blade?.winZ).toBeUndefined();
  });

  it("flags an enemy the item is bought against far more often, and an item that moves with it", () => {
    const sooner = MIN_MOVED_SIDE;
    const ring = patterns([
      { enemy: 44, games: many(sooner, () => game(true, [[SOUL_RING, 9], [SHADOW_BLADE, 16]])) },
      { enemy: 2, games: [...many(20, () => game(true, [[SHADOW_BLADE, 22]])), ...many(20, () => game(false, [[SOUL_RING, 9], [SHADOW_BLADE, 16]]))] },
      { enemy: 3, games: many(20, () => game(false, [[SHADOW_BLADE, 22]])) },
    ]).find((p) => p.item === SOUL_RING);
    expect(ring?.enemies.map((e) => e.enemy)).toContain(44);
    expect(ring?.moved).toEqual([{ item: SHADOW_BLADE, with: 16, without: 22 }]);
    expect(ring && flagCount(ring)).toBeGreaterThan(0);
  });

  it("doesn't test an enemy with fewer than ten games", () => {
    const ring = patterns([
      { enemy: 44, games: many(9, () => game(true, [[SOUL_RING, 9]])) },
      { enemy: 2, games: [...many(20, () => game(true, [])), ...many(20, () => game(false, [[SOUL_RING, 9]]))] },
    ]).find((p) => p.item === SOUL_RING);
    expect(ring?.enemies).toEqual([]);
  });

  it("flags an item the newer games buy far more often", () => {
    // Match ids rise with time: the first 30 games are older.
    const older = many(30, () => game(true, []));
    const newer = many(30, () => game(true, [[SOUL_RING, 9]]));
    const [ring] = patterns([{ enemy: 2, games: [...older, ...newer] }]);
    expect(ring?.older).toEqual({ bought: 0, games: 30 });
    expect(ring?.newer).toEqual({ bought: 30, games: 30 });
    expect(ring?.trendZ).toBeGreaterThan(3);
  });

  it("leaves items under the candidate share out and compares no lead for late items", () => {
    const found = patterns([{ enemy: 2, games: many(30, () => game(true, [[SHADOW_BLADE, 20]], 1000)) }]);
    expect(found.map((p) => p.item)).toEqual([SHADOW_BLADE]);
    expect(found[0]?.leadWith).toBeUndefined();
  });
});
