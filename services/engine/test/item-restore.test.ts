import { describe, expect, it } from "vitest";
import { restoreItemData } from "../src/data/item-restore";
import type { Snapshot } from "../src/engine/types";

const now = new Date("2026-11-22T13:17:00Z");
const positions = { 1: [900, 0, 0, 0, 0] };
const timings = (games: number): Snapshot["itemTimings"] => ({ 1: { 1: { all: { games, items: [[145, 16, 20]] } } } });
const starts = (games: number): Snapshot["itemStarts"] => ({ 1: { 1: { games, start: [[44, 1]], boots: [] } } });
const hero = (t: number, s: number, at: string): Snapshot =>
  ({
    generatedAt: at,
    heroes: {},
    bracketStats: {},
    laneRoles: {},
    matchups: {},
    synergy: {},
    positions,
    itemTimings: timings(t),
    itemTimingsAt: at,
    itemStarts: starts(s),
  }) as Snapshot;

describe("restoreItemData", () => {
  it("brings back the newest whole timings and starts from the daily copies", async () => {
    const days: Record<string, Snapshot> = {
      "daily/2026-11-22.json": hero(1, 20, "2026-11-22T09:49:53Z"),
      "daily/2026-11-21.json": hero(1, 20, "2026-11-21T21:07:12Z"),
      "daily/2026-11-20.json": hero(32000, 30000, "2026-11-20T18:38:34Z"),
      "daily/2026-11-19.json": hero(31000, 29000, "2026-11-19T10:25:50Z"),
    };
    const asked: string[] = [];
    const snapshot = hero(1, 20, "2026-11-22T09:49:53Z");
    const lines = await restoreItemData(snapshot, now, async (path) => {
      asked.push(path);
      return days[path] ?? null;
    });
    expect(asked).toEqual(["daily/2026-11-22.json", "daily/2026-11-21.json", "daily/2026-11-20.json"]);
    expect(snapshot.itemTimings).toEqual(timings(32000));
    expect(snapshot.itemStarts).toEqual(starts(30000));
    // The copy's date: the timings stay due, so the next run asks STRATZ again.
    expect(snapshot.itemTimingsAt).toBe("2026-11-20T18:38:34Z");
    expect(lines).toHaveLength(2);
  });

  it("restores only the broken part", async () => {
    const snapshot = hero(32000, 20, "2026-11-22T09:49:53Z");
    await restoreItemData(snapshot, now, async () => hero(5000, 30000, "2026-11-20T18:38:34Z"));
    expect(snapshot.itemTimings).toEqual(timings(32000));
    expect(snapshot.itemTimingsAt).toBe("2026-11-22T09:49:53Z");
    expect(snapshot.itemStarts).toEqual(starts(30000));
  });

  it("reads nothing when the snapshot's data is whole", async () => {
    const snapshot = hero(32000, 30000, "2026-11-22T09:49:53Z");
    const lines = await restoreItemData(snapshot, now, async () => {
      throw new Error("should not load");
    });
    expect(lines).toEqual([]);
  });

  it("skips a copy that fails to load and leaves the data when no copy is whole", async () => {
    const snapshot = hero(1, 20, "2026-11-22T09:49:53Z");
    const lines = await restoreItemData(snapshot, now, async (path) => {
      if (path === "daily/2026-11-22.json") throw new Error("GET failed: HTTP 500");
      return null;
    });
    expect(lines).toEqual([]);
    expect(snapshot.itemTimings).toEqual(timings(1));
  });
});
