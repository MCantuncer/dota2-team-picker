import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EvalMatch } from "../src/data/eval-matches";
import { loadEvalGames, monthPaths } from "../src/data/eval-store";
import { countPickPhases, phaseOf } from "../src/data/pick-phase";

/** Dire picks first, then the teams alternate; heroes 1-5 are Radiant, 6-10 Dire. */
const game = (radiantWin: boolean, id = 1): EvalMatch => ({
  id,
  startTime: 1793000000,
  rankTier: 54,
  radiantWin,
  picks: [6, 1, 7, 2, 8, 3, 9, 4, 10, 5].map((heroId) => ({ heroId, radiant: heroId <= 5, position: null })),
  bans: [],
});

describe("phaseOf", () => {
  it("splits a team's five picks into early, middle and late", () => {
    expect([0, 1, 2, 3, 4].map(phaseOf)).toEqual([0, 0, 1, 2, 2]);
  });
});

describe("countPickPhases", () => {
  it("counts each hero's games and wins in the phase its team picked it", () => {
    const counts = countPickPhases([game(true, 1), game(false, 2)]);
    // Hero 1 is Radiant's first pick, hero 8 Dire's third, hero 5 Radiant's last.
    expect(counts[1]).toEqual({ games: [2, 0, 0], wins: [1, 0, 0] });
    expect(counts[8]).toEqual({ games: [0, 2, 0], wins: [0, 1, 0] });
    expect(counts[5]).toEqual({ games: [0, 0, 2], wins: [0, 0, 1] });
    expect(Object.keys(counts)).toHaveLength(10);
  });

  it("gives no counts without games", () => {
    expect(countPickPhases([])).toEqual({});
  });
});

describe("monthPaths", () => {
  it("lists every month file from the first time to the second", () => {
    const aug30 = Date.UTC(2026, 7, 30) / 1000;
    const oct2 = Date.UTC(2026, 9, 2) / 1000;
    expect(monthPaths(aug30, oct2)).toEqual(["eval/matches-2026-08.json", "eval/matches-2026-09.json", "eval/matches-2026-10.json"]);
    expect(monthPaths(oct2, oct2)).toEqual(["eval/matches-2026-10.json"]);
  });
});

describe("loadEvalGames", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads a local file and skips games with a bad shape", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "eval-")), "games.json");
    writeFileSync(file, JSON.stringify([game(true), { id: "bad" }]));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await loadEvalGames(file)).toEqual([game(true)]);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("treats a month the bucket does not have as no games", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 400 })));
    expect(await loadEvalGames("eval/matches-2020-01.json")).toEqual([]);
  });

  it("fails on other bucket errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    await expect(loadEvalGames("eval/matches-2020-01.json")).rejects.toThrow("HTTP 503");
  });
});
