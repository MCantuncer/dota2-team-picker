import { describe, expect, it } from "vitest";
import { itemTrends as trendsOf, type Timings } from "../src/engine/item-trends";
import type { ItemInfo } from "../src/engine/types";

const SOUL_RING = 178;
const DIFFUSAL = 174;
const item = (key: string, cost: number): ItemInfo => ({ key, name: key, cost, img: "", components: [] });
const ITEMS: Record<string, ItemInfo> = { [SOUL_RING]: item("soul_ring", 680), [DIFFUSAL]: item("diffusal_blade", 2500) };
const itemTrends = (older: Timings, newer: Timings, olderItems = ITEMS) => trendsOf(older, newer, olderItems, ITEMS);
/** Slark pos 1 in one copy: that STRATZ week's games and purchase counts. */
const week = (games: number, shares: [number, number][]): Timings => ({ 93: { 1: { all: { games, items: [], shares } } } });

describe("itemTrends", () => {
  it("finds an item bought more often this week, and not one that held steady", () => {
    const { trends, compared, checks } = itemTrends(
      week(100000, [[SOUL_RING, 30000], [DIFFUSAL, 80000]]),
      week(60000, [[SOUL_RING, 27000], [DIFFUSAL, 48000]]),
    );
    expect(compared).toBe(1);
    expect(checks).toBe(2);
    expect(trends).toHaveLength(1);
    expect(trends[0]).toMatchObject({ hero: 93, position: 1, item: SOUL_RING, older: { bought: 30000, games: 100000 }, newer: { bought: 27000, games: 60000 } });
  });

  it("finds a new item, counting it at the most it could have been before", () => {
    const { trends } = itemTrends(week(100000, []), week(100000, [[SOUL_RING, 10000]]));
    expect(trends[0]).toMatchObject({ item: SOUL_RING, older: { bought: 3000, games: 100000, atMost: true } });
  });

  it("doesn't flag an item that only crossed into the stored list", () => {
    // 3.5% now: maybe 2.9% before, so no change can be claimed.
    const { trends } = itemTrends(week(100000, []), week(100000, [[SOUL_RING, 3500]]));
    expect(trends).toEqual([]);
  });

  it("skips an item the older copy couldn't count, like one that cost under 500 then", () => {
    const cheap = { ...ITEMS, [SOUL_RING]: item("soul_ring", 450) };
    const { trends, checks } = itemTrends(week(100000, []), week(100000, [[SOUL_RING, 40000]]), cheap);
    expect(trends).toEqual([]);
    expect(checks).toBe(0);
  });

  it("counts heroes it couldn't compare", () => {
    const result = itemTrends(week(500, [[SOUL_RING, 300]]), week(100000, [[SOUL_RING, 30000]]));
    expect(result).toMatchObject({ compared: 0, tooFew: 1, trends: [] });
    const missing = itemTrends({}, week(100000, [[SOUL_RING, 30000]]));
    expect(missing.noCounts).toBe(1);
  });
});
