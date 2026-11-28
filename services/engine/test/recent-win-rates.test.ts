import { describe, expect, it } from "vitest";
import { applyRecentWinRates, dayWeights, letterDay, MIN_GROUP_GAMES, unusable } from "../src/data/recent-win-rates";
import type { MetaDay, MetaFile } from "../src/data/meta";
import type { Snapshot } from "../src/engine/types";

const PATCH = { name: "7.42", startedAt: "2026-11-18T21:28:00.000Z" };
const LETTER = { ...PATCH, release: { name: "7.42a", startedAt: "2026-11-25T08:00:00.000Z", from: "valve" as const } };

/** A day where hero 1 has `games` per rank group at `win` (0 to 1). */
function day(index: number, games: number, win: number, complete = true): MetaDay {
  const g = [games * 4, Math.round(games * 4 * win), ...[1, 2, 3, 4].flatMap(() => [games, Math.round(games * win)])];
  return { index, from: "", to: "", complete, games: [0, 0, 0, 0, 0], heroes: { "1": g } };
}

function meta(days: MetaDay[], patch: MetaFile["patch"] = LETTER, computedAt = "2026-11-27T23:00:00.000Z"): MetaFile {
  return { computedAt, patch, days, base: [], roles: {} };
}

/** Hero 1 at 53% in every bracket, 10,000 picks each. */
function snapshot(): Snapshot {
  return {
    patch: LETTER,
    heroes: { "1": { id: 1, name: "Phantom Assassin", roles: [], attackType: "Melee", primaryAttr: "agi" } },
    bracketStats: { "1": { picks: Array(8).fill(10_000), wins: [5300, 5300, 5300, 5300, 5300, 5300, 5400, 5200] } },
  } as unknown as Snapshot;
}

const NOW = new Date("2026-11-27T23:30:00.000Z");

describe("dayWeights", () => {
  it("halves each day before the newest complete day", () => {
    expect(dayWeights([day(0, 1, 0.5), day(1, 1, 0.5), day(2, 1, 0.5), day(3, 1, 0.5, false)])).toEqual([0.25, 0.5, 1, 1]);
  });
  it("counts every day from a fresh letter patch fully", () => {
    expect(dayWeights([day(4, 1, 0.5), day(5, 1, 0.5), day(6, 1, 0.5), day(7, 1, 0.5), day(8, 1, 0.5, false)], 6)).toEqual([0.25, 0.5, 1, 1, 1]);
  });
});

describe("letterDay", () => {
  it("is the patch day the letter patch came out on", () => {
    expect(letterDay(LETTER, NOW)).toBe(6);
  });
  it("is undefined without a letter patch or once it is 14 days old", () => {
    expect(letterDay(PATCH, NOW)).toBeUndefined();
    expect(letterDay(LETTER, new Date("2026-12-09T08:00:00.000Z"))).toBeUndefined();
  });
});

describe("unusable", () => {
  it("refuses another patch's or an old meta.json", () => {
    expect(unusable(meta([day(0, 1, 0.5)], { name: "7.41", startedAt: "2026-10-01T00:00:00.000Z" }), snapshot(), NOW)).toMatch(/7\.41/);
    expect(unusable(meta([day(0, 1, 0.5)], LETTER, "2026-11-25T00:00:00.000Z"), snapshot(), NOW)).toMatch(/hours old/);
    expect(unusable(meta([]), snapshot(), NOW)).toMatch(/no days/);
    expect(unusable(meta([day(0, 1, 0.5)]), snapshot(), NOW)).toBeNull();
  });
});

describe("applyRecentWinRates", () => {
  it("moves each rank group to the letter patch's rate and keeps picks and bracket differences", () => {
    const s = snapshot();
    // 55% before 7.42a (day 6), 50% from it on.
    const m = meta([day(4, 4000, 0.55), day(5, 4000, 0.55), day(6, 4000, 0.5), day(7, 4000, 0.5)]);
    const r = applyRecentWinRates(s, m, NOW);
    expect(r.groups).toBe(4);
    // Weights 0.25, 0.5, 1, 1: (0.25 + 0.5) * 55% + 2 * 50% over 2.75 = 51.36%.
    const stats = s.bracketStats["1"]!;
    expect(stats.picks).toEqual(Array(8).fill(10_000));
    expect(stats.wins.slice(0, 6)).toEqual(Array(6).fill(5136));
    expect(stats.wins[6]! - stats.wins[7]!).toBe(200);
    expect(r.moved[0]).toMatchObject({ id: 1 });
    expect(r.moved[0]!.to).toBeCloseTo(51.36, 1);
  });

  it("keeps heroStats' rate for a group with too few weighted games", () => {
    const s = snapshot();
    applyRecentWinRates(s, meta([day(6, MIN_GROUP_GAMES / 2 - 1, 0.4), day(7, MIN_GROUP_GAMES / 2 - 1, 0.4)]), NOW);
    expect(s.bracketStats["1"]!.wins).toEqual([5300, 5300, 5300, 5300, 5300, 5300, 5400, 5200]);
  });
});
