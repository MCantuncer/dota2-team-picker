import { describe, expect, it } from "vitest";
import { checkWinRange, fitWinRange, MIN_FIT_GAMES, rangeCheckToMarkdown, type EdgeSample } from "../src/backtest/win-range";
import { addEdgeDays, EDGE_DAYS, edgeDayQuery, edgeWindow, toPublicGames, type EdgeDays, type EdgeDeps } from "../src/data/public-edges";
import { winRange, type WinRangeModel } from "../src/engine/win-range";
import { fixture } from "./fixture";

/** A deterministic stand-in for Math.random (mulberry32), so the synthetic games are the same every run. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

/**
 * Games whose Radiant win chance is 53% plus 0.5 points per point of edge. A positive `shift` makes
 * the favourite of each game win that much more often, a negative one less.
 */
function synthetic(n: number, seed = 7, shift = 0): EdgeSample[] {
  const rnd = random(seed);
  return Array.from({ length: n }, () => {
    const edge = (rnd() - 0.5) * 60;
    const base = 0.53 + 0.005 * edge;
    return { edge, won: rnd() < base + shift * Math.sign(base - 0.5) };
  });
}

const DAYS = { from: "2026-10-25", to: "2026-11-14" };

describe("winRange", () => {
  const model: WinRangeModel = {
    fittedAt: "2026-11-15T00:00:00Z",
    games: 30000,
    days: DAYS,
    cuts: [-5, 5],
    bands: [
      { games: 10000, won: 0.45, low: 0.44, high: 0.46 },
      { games: 10000, won: 0.53, low: 0.52, high: 0.54 },
      { games: 10000, won: 0.6, low: 0.59, high: 0.61 },
    ],
  };

  it("shows nothing without a checked model or with a bad edge", () => {
    expect(winRange(undefined, 3, true)).toBeNull();
    expect(winRange(model, Number.NaN, true)).toBeNull();
  });

  it("finds the band, with an edge on a cut in the band above", () => {
    expect(winRange(model, -9, true)?.won).toBe(0.45);
    expect(winRange(model, -5, true)?.won).toBe(0.53);
    expect(winRange(model, 4.9, true)?.won).toBe(0.53);
    expect(winRange(model, 5, true)?.won).toBe(0.6);
  });

  it("gives Dire the other side of the same band", () => {
    expect(winRange(model, 0, true)).toEqual({ won: 0.53, low: 0.52, high: 0.54, games: 10000 });
    expect(winRange(model, 0, false)).toEqual({ won: 0.47, low: 0.46, high: 0.48, games: 10000 });
  });
});

describe("fitWinRange", () => {
  it("makes no model from too few games", () => {
    expect(fitWinRange(synthetic(MIN_FIT_GAMES - 1), "now", DAYS)).toBeNull();
  });

  it("finds each band's real Radiant win rate inside its range", () => {
    const model = fitWinRange(synthetic(40000), "now", DAYS)!;
    expect(model.cuts).toHaveLength(9);
    expect([...model.cuts].sort((a, b) => a - b)).toEqual(model.cuts);
    expect(model.bands.reduce((s, b) => s + b.games, 0)).toBe(40000);
    // Rates climb with the edge (two bands apart, past the noise of the narrow end bands), and each range holds its rate.
    for (let i = 2; i < model.bands.length; i++) expect(model.bands[i]!.won).toBeGreaterThan(model.bands[i - 2]!.won);
    for (const b of model.bands) expect(b.low).toBeLessThanOrEqual(b.won);
    for (const b of model.bands) expect(b.high).toBeGreaterThanOrEqual(b.won);
    // The middle band (edges around 0) wins about Radiant's 53%.
    expect(winRange(model, 0, true)!.won).toBeCloseTo(0.53, 1);
  });
});

describe("checkWinRange", () => {
  const model = fitWinRange(synthetic(40000), "now", DAYS)!;

  it("passes on newer games like the fitted ones", () => {
    const check = checkWinRange(model, synthetic(15000, 11));
    expect(check.passes).toBe(true);
    expect(check.bands.every((b) => b.judged && b.ok)).toBe(true);
  });

  it("fails when the favourites win less than shown", () => {
    expect(checkWinRange(model, synthetic(15000, 11, -0.06)).passes).toBe(false);
  });

  it("allows a careful range, where the favourites won a little more than shown", () => {
    expect(checkWinRange(model, synthetic(15000, 11, 0.04)).passes).toBe(true);
    expect(checkWinRange(model, synthetic(15000, 11, 0.09)).passes).toBe(false);
  });

  it("fails when too few bands have enough newer games to judge", () => {
    const check = checkWinRange(model, synthetic(1500, 11));
    expect(check.bands.filter((b) => b.judged).length * 2).toBeLessThan(check.bands.length);
    expect(check.passes).toBe(false);
  });

  it("writes a table with one row per band", () => {
    const text = rangeCheckToMarkdown(checkWinRange(model, synthetic(15000, 11)), 40000);
    expect(text).toContain("passed");
    expect(text.split("\n").filter((l) => l.startsWith("| ") && /\d/.test(l))).toHaveLength(10);
  });
});

describe("public game edges", () => {
  const DAY = 24 * 60 * 60;
  const nov15 = Date.parse("2026-11-15T10:00:00Z") / 1000;

  it("queries one UTC day's sample", () => {
    const q = edgeDayQuery("2026-11-14");
    expect(q).toContain(`start_time >= ${Date.parse("2026-11-14T00:00:00Z") / 1000}`);
    expect(q).toContain(`start_time < ${Date.parse("2026-11-15T00:00:00Z") / 1000}`);
    expect(q).toContain("lobby_type = 7 and game_mode = 22");
    expect(q).toMatch(/match_id % \d+ = 0/);
  });

  it("keeps the last whole days, after the patch's first full copy", () => {
    const days = edgeWindow(nov15, 0);
    expect(days).toHaveLength(EDGE_DAYS);
    expect(days.at(-1)).toBe("2026-11-14");
    // A patch out on Nov 10: the Nov 11 copy is the first built on it, so games from Nov 12 on.
    expect(edgeWindow(nov15, Date.parse("2026-11-10T18:00:00Z") / 1000)).toEqual(["2026-11-12", "2026-11-13", "2026-11-14"]);
  });

  it("reads only well formed explorer rows", () => {
    const good = { radiant_win: true, avg_rank_tier: 54, radiant_team: [1, 2, 3, 4, 5], dire_team: [3, 4, 5, 6, 7] };
    const games = toPublicGames([good, { ...good, radiant_win: "yes" }, { ...good, dire_team: [1, 2] }, { ...good, avg_rank_tier: null }, null]);
    expect(games).toHaveLength(2);
    expect(games[1]!.rankTier).toBeNull();
    expect(() => toPublicGames(undefined)).toThrow();
  });

  function deps(saved: EdgeDays, over: Partial<EdgeDeps> = {}) {
    const calls = { saves: [] as EdgeDays[], copies: [] as string[], queries: 0 };
    const row = (win: boolean) => ({ radiant_win: win, avg_rank_tier: 54, radiant_team: [1, 2, 3, 4, 5], dire_team: [3, 4, 5, 6, 7] });
    const d: EdgeDeps = {
      store: { load: async () => saved, save: async (days) => void calls.saves.push(days) },
      openDota: async <T>() => {
        calls.queries++;
        return { rows: [row(true), row(false), { ...row(true), radiant_team: [1, 2, 3, 4, 99] }] } as T;
      },
      heroData: async (path) => (calls.copies.push(path), fixture()),
      now: nov15,
      patchStart: Date.parse("2026-11-10T18:00:00Z") / 1000,
      dryRun: false,
      ...over,
    };
    return { d, calls };
  }

  it("scores the missing days with the copy of the day before and drops old days", async () => {
    const { d, calls } = deps({ "2026-11-01": [[1, 1]], "2026-11-13": [[2.5, 0]] });
    const result = await addEdgeDays(d);
    expect(Object.keys(result.days).sort()).toEqual(["2026-11-12", "2026-11-13", "2026-11-14"]);
    expect(result.days["2026-11-13"]).toEqual([[2.5, 0]]);
    expect(calls.copies).toEqual(["daily/2026-11-11.json", "daily/2026-11-13.json"]);
    // The game with an unknown hero is left out; the edge is the same for both scored games.
    expect(result.days["2026-11-14"]).toHaveLength(2);
    expect(result.days["2026-11-14"]!.map(([, won]) => won)).toEqual([1, 0]);
    expect(calls.saves).toHaveLength(1);
  });

  it("skips a day with no copy of the day before or a failing query, and retries the query once", async () => {
    let failures = 0;
    const { d, calls } = deps(
      {},
      {
        heroData: async (path) => (path === "daily/2026-11-11.json" ? null : fixture()),
        openDota: async <T>() => {
          failures++;
          throw new Error("GET /explorer failed: HTTP 400");
          return undefined as T;
        },
      },
    );
    const result = await addEdgeDays(d);
    expect(result.added).toEqual([]);
    expect(result.skipped.map((s) => s.day)).toEqual(["2026-11-12", "2026-11-13", "2026-11-14"]);
    expect(result.skipped[0]!.why).toContain("no hero data copy");
    expect(failures).toBe(4);
    expect(calls.saves).toHaveLength(0);
  });

  it("treats an explorer error as a failed query", async () => {
    const { d } = deps({}, { openDota: async <T>() => ({ err: "timeout" }) as T });
    const result = await addEdgeDays(d);
    expect(result.skipped[0]!.why).toContain("timeout");
  });

  it("saves nothing on a dry run or when nothing changed", async () => {
    const dry = deps({}, { dryRun: true });
    expect((await addEdgeDays(dry.d)).added).toHaveLength(3);
    expect(dry.calls.saves).toHaveLength(0);
    const full = deps({ "2026-11-12": [[0, 1]], "2026-11-13": [[0, 1]], "2026-11-14": [[0, 1]] });
    await addEdgeDays(full.d);
    expect(full.calls.queries).toBe(0);
    expect(full.calls.saves).toHaveLength(0);
  });
});
