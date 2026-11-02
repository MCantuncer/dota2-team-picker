import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SLICES_PER_QUERY,
  fetchItemTimings,
  itemTimingsDue,
  itemTimingsQuery,
  lateMinute,
  timingRequests,
  toTimingSlice,
  type PurchaseRow,
} from "../src/data/item-timings";
import type { ItemInfo, Snapshot } from "../src/engine/types";

/** Real STRATZ rows for Anti-Mage pos 1 in Legend to Ancient (Nov 2026), trimmed to four items. */
const ANTI_MAGE: PurchaseRow[] = JSON.parse(
  readFileSync(new URL("./fixtures/stratz-anti-mage-pos1-legend-ancient.json", import.meta.url), "utf8"),
);

const item = (key: string, name: string, cost: number): ItemInfo => ({ key, name, cost, img: "", components: [] });
const ITEMS: Record<string, ItemInfo> = {
  36: item("magic_wand", "Magic Wand", 450),
  69: item("pers", "Perseverance", 1700),
  145: item("bfury", "Battle Fury", 4100),
  147: item("manta", "Manta Style", 4650),
};

const row = (time: number, matchCount: number, winCount: number, itemId = 145): PurchaseRow => ({
  itemId,
  instance: 0,
  time,
  matchCount,
  winCount,
});

describe("timingRequests", () => {
  it("asks for each hero's two most played positions in every rank slice", () => {
    const requests = timingRequests({ 1: [900, 30, 0, 0, 0], 26: [0, 0, 0, 300, 700] });
    expect(requests.filter((r) => r.heroId === 1).map((r) => r.position)).toEqual([1, 1, 1, 1, 1, 2, 2, 2, 2, 2]);
    expect(requests.filter((r) => r.heroId === 26).map((r) => r.position)).toEqual([5, 5, 5, 5, 5, 4, 4, 4, 4, 4]);
    expect(requests.filter((r) => r.heroId === 1 && r.position === 1).map((r) => r.slice)).toEqual(["all", "1", "2", "3", "4"]);
  });

  it("adds a third position played in at least 15% of games, for flex picks like carry Vengeful Spirit", () => {
    const positions = (games: number[]) => [...new Set(timingRequests({ 20: games }).map((r) => r.position))];
    expect(positions([200, 50, 50, 300, 400])).toEqual([5, 4, 1]);
    expect(positions([100, 50, 50, 400, 400])).toEqual([4, 5]);
  });

  it("skips positions nobody plays", () => {
    expect(timingRequests({ 1: [900, 0, 0, 0, 0] }).map((r) => r.position)).toEqual([1, 1, 1, 1, 1]);
  });
});

describe("itemTimingsQuery", () => {
  it("asks for each slice under its own alias with the STRATZ rank names", () => {
    const query = itemTimingsQuery([
      { heroId: 1, position: 1, slice: "all" },
      { heroId: 1, position: 1, slice: "3" },
    ]);
    expect(query).toContain("s0: itemFullPurchase(heroId: 1, positionIds: [POSITION_1]) {");
    expect(query).toContain("s1: itemFullPurchase(heroId: 1, positionIds: [POSITION_1], bracketBasicIds: [LEGEND_ANCIENT]) {");
  });

  it("refuses an empty or oversized batch", () => {
    expect(() => itemTimingsQuery([])).toThrow();
    const many = Array.from({ length: SLICES_PER_QUERY + 1 }, () => ({ heroId: 1, position: 1 as const, slice: "all" as const }));
    expect(() => itemTimingsQuery(many)).toThrow();
  });
});

describe("lateMinute", () => {
  it("is the first minute past the average where the win rate falls 5 points under the item's own", () => {
    // Win rate 55% overall; minute 16 is at 45%.
    const rows = [row(13, 100, 70), row(14, 200, 120), row(15, 200, 110), row(16, 100, 45), row(17, 50, 10)];
    expect(lateMinute(rows, 14)).toBe(16);
  });

  it("falls back to the 75th percentile when the win rate stays flat", () => {
    const rows = [row(30, 100, 60), row(32, 100, 60), row(34, 100, 60), row(40, 100, 60)];
    expect(lateMinute(rows, 34)).toBe(34 + 1);
    expect(lateMinute(rows, 30)).toBe(34);
  });

  it("ignores a drop at a minute with too few games", () => {
    const rows = [row(10, 1000, 600), row(11, 1000, 600), row(12, 5, 0), row(13, 1000, 600)];
    expect(lateMinute(rows, 11)).toBe(13);
  });
});

describe("toTimingSlice", () => {
  it("turns real STRATZ rows into core items with minutes, most bought first", () => {
    const slice = toTimingSlice(ANTI_MAGE, ITEMS)!; // The fixture has rows.
    // Magic Wand is a lane item, and the second Perseverance (instance 1) is not counted.
    expect(slice.items.map(([id]) => id)).toEqual([69, 145, 147]);
    const [, battleFuryMinute, battleFuryLate] = slice.items[1]!;
    expect(battleFuryMinute).toBe(15);
    expect(battleFuryLate).toBe(16);
    expect(slice.games).toBe(72934);
  });

  it("keeps the small items most players buy in lane, in buy order", () => {
    // Magic Wand is bought early by most Anti-Mages; Perseverance costs 1,400 in today's patch.
    const cheapPers = { ...ITEMS, 69: item("pers", "Perseverance", 1400) };
    const lane = toTimingSlice(ANTI_MAGE, cheapPers)!.lane!; // The fixture has wand and Perseverance rows.
    expect(lane.map(([id]) => id)).toEqual([36, 69]);
    expect(lane[0]![1]).toBeLessThan(lane[1]![1]);
  });

  it("leaves out items bought by few players or after the lane", () => {
    const rows = [row(2, 1000, 500, 145), row(3, 100, 50, 36), row(14, 900, 450, 69)];
    const cheapPers = { ...ITEMS, 69: item("pers", "Perseverance", 1400) };
    // Wand: 10% of games. Perseverance: at 14 min, after the lane.
    expect(toTimingSlice(rows, cheapPers)!.lane).toBeUndefined();
  });

  it("is null for a slice STRATZ has no data for", () => {
    expect(toTimingSlice([], ITEMS)).toBeNull();
  });
});

describe("fetchItemTimings", () => {
  const snapshot = (): Snapshot => ({
    generatedAt: "",
    heroes: {},
    bracketStats: {},
    matchups: {},
    synergy: {},
    laneRoles: {},
    positions: { 1: [900, 0, 0, 0, 0] },
    items: ITEMS,
  });

  it("stores each slice STRATZ answered and leaves out the empty ones", async () => {
    const queries: string[] = [];
    const data = snapshot();
    await fetchItemTimings(
      data,
      async (query) => {
        queries.push(query);
        return { heroStats: { s0: ANTI_MAGE, s3: ANTI_MAGE, s1: [], s2: null, s4: [{ bad: true }] } };
      },
      new Date("2026-11-02T00:00:00Z"),
    );
    expect(queries).toHaveLength(1);
    expect(Object.keys(data.itemTimings![1]![1]!).sort()).toEqual(["3", "all"]);
    expect(data.itemTimingsAt).toBe("2026-11-02T00:00:00.000Z");
    // Start items come with the timings: without them, the timings are due again.
    expect(itemTimingsDue(data, new Date("2026-11-02T12:00:00Z"))).toBe(true);
    data.itemStarts = {};
    expect(itemTimingsDue(data, new Date("2026-11-02T12:00:00Z"))).toBe(false);
    expect(itemTimingsDue(data, new Date("2026-11-03T00:00:00Z"))).toBe(true);
  });

  it("fails when STRATZ answers without heroStats", async () => {
    await expect(fetchItemTimings(snapshot(), async () => ({}), new Date())).rejects.toThrow("no heroStats");
  });

  it("needs positions and items", async () => {
    await expect(fetchItemTimings({ ...snapshot(), positions: undefined }, async () => ({}), new Date())).rejects.toThrow();
  });
});
