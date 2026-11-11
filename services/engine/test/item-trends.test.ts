import { describe, expect, it } from "vitest";
import { itemTrends, type Timings } from "../src/engine/item-trends";

const SOUL_RING = 178;
const DIFFUSAL = 174;
/** Slark pos 1 at one day: all-ranks games and purchase counts. */
const day = (games: number, shares: [number, number][]): Timings => ({ 93: { 1: { all: { games, items: [], shares } } } });

describe("itemTrends", () => {
  it("finds an item bought more often in the newer games", () => {
    // Older window: 10,000 games, 3,000 Soul Rings (30%). Newer: 10,000 games, 4,500 (45%).
    const trends = itemTrends(
      day(100000, [[SOUL_RING, 30000], [DIFFUSAL, 80000]]),
      day(110000, [[SOUL_RING, 33000], [DIFFUSAL, 88000]]),
      day(120000, [[SOUL_RING, 37500], [DIFFUSAL, 96000]]),
    );
    expect(trends).toHaveLength(1);
    expect(trends[0]).toMatchObject({ hero: 93, position: 1, item: SOUL_RING, older: { bought: 3000, games: 10000 }, newer: { bought: 4500, games: 10000 } });
  });

  it("skips a hero whose counts dropped (a new patch) or whose windows are small", () => {
    const reset = itemTrends(day(100000, [[SOUL_RING, 30000]]), day(110000, [[SOUL_RING, 33000]]), day(5000, [[SOUL_RING, 2500]]));
    expect(reset).toEqual([]);
    const small = itemTrends(day(100000, [[SOUL_RING, 30000]]), day(100500, [[SOUL_RING, 30100]]), day(101000, [[SOUL_RING, 30400]]));
    expect(small).toEqual([]);
  });

  it("leaves out an item missing from an older copy", () => {
    const trends = itemTrends(day(100000, []), day(110000, [[SOUL_RING, 3000]]), day(120000, [[SOUL_RING, 7500]]));
    expect(trends).toEqual([]);
  });
});
