import { describe, expect, it } from "vitest";
import {
  addVs,
  addWith,
  blendCounts,
  fetchPatchCounts,
  GAMES_PER_DAY_GUESS,
  GAMES_PER_SLICE,
  gamesIn,
  lastStratzCounts,
  MAX_SLICES,
  patchIsFresh,
  toPairRows,
  vsQuery,
  withQuery,
} from "../src/data/patch-matchups";
import type { StratzCounts } from "../src/data/stratz-matchups";
import type { Snapshot } from "../src/engine/types";

const empty = (): StratzCounts => ({ matchups: {}, synergy: {}, rankMatchups: {}, rankSynergy: {} });

describe("toPairRows", () => {
  it("reads numbers and numeric text, and drops odd rows", () => {
    const rows = toPairRows([
      { g: 3, a: 1, b: 2, games: 10, wins: 6 },
      { g: "0", a: "5", b: "8", games: "4", wins: "1" },
      { g: 5, a: 1, b: 2, games: 10, wins: 6 }, // no such rank group
      { g: 1, a: 1, b: 1, games: 10, wins: 6 }, // same hero
      { g: 1, a: 1, b: 2, games: 3, wins: 4 }, // more wins than games
      { g: 1, a: 1, b: 2, games: 0, wins: 0 },
      { g: 1, a: 1.5, b: 2, games: 3, wins: 1 },
      null,
    ]);
    expect(rows).toEqual([
      { g: 3, a: 1, b: 2, games: 10, wins: 6 },
      { g: 0, a: 5, b: 8, games: 4, wins: 1 },
    ]);
  });

  it("throws when the answer has no rows", () => {
    expect(() => toPairRows(undefined)).toThrow("no rows");
  });
});

describe("addVs and addWith", () => {
  it("counts both heroes' side of a pair, in every rank and its own rank group", () => {
    const counts = empty();
    // Radiant Anti-Mage (1) against Dire Axe (2): 10 games, Radiant won 6, in Legend and Ancient.
    addVs(counts, [{ g: 3, a: 1, b: 2, games: 10, wins: 6 }]);
    // Unknown rank: only every rank.
    addVs(counts, [{ g: 0, a: 2, b: 1, games: 5, wins: 1 }]);
    expect(counts.matchups[1]?.[2]).toEqual({ games: 15, wins: 10 });
    expect(counts.matchups[2]?.[1]).toEqual({ games: 15, wins: 5 });
    expect(counts.rankMatchups[3]?.[1]?.[2]).toEqual({ games: 10, wins: 6 });
    expect(counts.rankMatchups[3]?.[2]?.[1]).toEqual({ games: 10, wins: 4 });
    expect(Object.keys(counts.rankMatchups)).toEqual(["3"]);
  });

  it("keys same-side pairs low id first and adds Radiant and Dire rows", () => {
    const counts = empty();
    addWith(counts, [{ g: 2, a: 1, b: 2, games: 7, wins: 4 }]);
    addWith(counts, [{ g: 2, a: 1, b: 2, games: 3, wins: 1 }]);
    expect(counts.synergy["1-2"]).toEqual({ games: 10, wins: 5 });
    expect(counts.rankSynergy[2]?.["1-2"]).toEqual({ games: 10, wins: 5 });
  });

  it("finds the games from the pairs: 25 Radiant-Dire pairs a game", () => {
    const counts = empty();
    const radiant = [1, 2, 3, 4, 5];
    const dire = [6, 7, 8, 9, 10];
    addVs(counts, radiant.flatMap((a) => dire.map((b) => ({ g: 0 as const, a, b, games: 4, wins: 3 }))));
    expect(gamesIn(counts)).toBe(4);
  });
});

describe("blendCounts", () => {
  it("adds a share of STRATZ to every pair of either source, in every slice", () => {
    const patch = empty();
    patch.matchups = { "1": { "2": { games: 100, wins: 60 } } };
    patch.synergy = { "1-2": { games: 50, wins: 30 } };
    patch.rankMatchups = { "3": { "1": { "2": { games: 40, wins: 20 } } } };
    const stratz = empty();
    stratz.matchups = { "1": { "2": { games: 1000, wins: 400 }, "3": { games: 10, wins: 5 } } };
    stratz.synergy = { "1-3": { games: 8, wins: 2 } };
    stratz.rankSynergy = { "4": { "1-2": { games: 4, wins: 1 } } };

    const out = blendCounts(patch, stratz, 0.25);
    expect(out.matchups["1"]).toEqual({ "2": { games: 350, wins: 160 }, "3": { games: 2.5, wins: 1.3 } });
    expect(out.synergy).toEqual({ "1-2": { games: 50, wins: 30 }, "1-3": { games: 2, wins: 0.5 } });
    expect(out.rankMatchups["3"]?.["1"]?.["2"]).toEqual({ games: 40, wins: 20 });
    expect(out.rankSynergy["4"]?.["1-2"]).toEqual({ games: 1, wins: 0.3 });
    expect(Object.keys(out.rankMatchups).sort()).toEqual(["3", "4"]);
  });
});

describe("queries", () => {
  it("reads one slice of this patch's ranked All Pick games", () => {
    const sql = vsQuery(1795037287, 4, 2);
    expect(sql).toContain("m.start_time >= 1795037287");
    expect(sql).toContain("m.lobby_type = 7 and m.game_mode = 22");
    expect(sql).toContain("m.match_id % 4 = 2");
    expect(vsQuery(1795037287, 1, 0)).not.toContain("%");
    expect(withQuery(1795037287, 1, 0, "dire")).toContain("not m.radiant_win");
    expect(withQuery(1795037287, 1, 0, "dire")).toContain("unnest(m.dire_team) a, unnest(m.dire_team) b");
  });

  it("calls a patch fresh for its first 14 days", () => {
    const start = Date.parse("2026-11-18T21:28:07Z") / 1000;
    expect(patchIsFresh(start, new Date("2026-11-21T10:00:00Z"))).toBe(true);
    expect(patchIsFresh(start, new Date("2026-12-03T10:00:00Z"))).toBe(false);
  });
});

describe("fetchPatchCounts", () => {
  /** Ten days after the test patch started at Unix second 0. */
  const NOW = new Date(10 * 24 * 60 * 60 * 1000);
  const vsRow = { g: 1, a: 1, b: 2, games: 25, wins: 10 };
  const withRow = { g: 1, a: 1, b: 3, games: 5, wins: 2 };
  const fakeExplorer = (games: number, fail: (sql: string, call: number) => boolean = () => false) => {
    const asked: string[] = [];
    const get = async <T>(path: string): Promise<T> => {
      const sql = decodeURIComponent(path.replace("/explorer?sql=", ""));
      asked.push(sql);
      if (fail(sql, asked.length)) throw new Error("GET /explorer failed: HTTP 400");
      if (sql.startsWith("select count(*)")) return { rows: [{ games: String(games) }] } as T;
      return { rows: [sql.includes("unnest(m.radiant_team) a, unnest(m.dire_team) b") ? vsRow : withRow] } as T;
    };
    return { get, asked };
  };

  it("reads as many slices as the games need, up to MAX_SLICES", async () => {
    const small = fakeExplorer(GAMES_PER_SLICE - 1);
    await fetchPatchCounts(small.get, 0, NOW);
    expect(small.asked).toHaveLength(1 + 3);

    const big = fakeExplorer(GAMES_PER_SLICE * 10);
    const { counts } = await fetchPatchCounts(big.get, 0, NOW);
    expect(big.asked).toHaveLength(1 + 3 * MAX_SLICES);
    expect(big.asked.filter((q) => q.includes("% 10 = "))).toHaveLength(3 * MAX_SLICES);
    expect(counts.matchups[1]?.[2]).toEqual({ games: 25 * MAX_SLICES, wins: 10 * MAX_SLICES });
    // Radiant and Dire rows of each slice.
    expect(counts.synergy["1-3"]).toEqual({ games: 10 * MAX_SLICES, wins: 4 * MAX_SLICES });
  });

  it("tries a failed query once more", async () => {
    const { get, asked } = fakeExplorer(10, (_, call) => call === 2);
    const { games } = await fetchPatchCounts(get, 0, NOW);
    expect(asked).toHaveLength(5);
    expect(games).toBe(1);
  });

  it("takes a generous guess of the games when the count fails twice, so slices stay small", async () => {
    const { get, asked } = fakeExplorer(10, (sql) => sql.startsWith("select count(*)"));
    const { games } = await fetchPatchCounts(get, 0, NOW);
    // 10 days at GAMES_PER_DAY_GUESS: 24 slices, of which MAX_SLICES are read.
    const slices = Math.ceil((10 * GAMES_PER_DAY_GUESS) / GAMES_PER_SLICE);
    expect(asked.filter((q) => q.includes(`% ${slices} = `))).toHaveLength(3 * MAX_SLICES);
    expect(asked).toHaveLength(2 + 3 * MAX_SLICES);
    expect(games).toBe(MAX_SLICES);
  });

  it("throws when a query fails twice, so no partial read is used", async () => {
    const { get } = fakeExplorer(10, (sql) => sql.includes("radiant_team) b"));
    await expect(fetchPatchCounts(get, 0, NOW)).rejects.toThrow("HTTP 400");
  });
});

describe("lastStratzCounts", () => {
  const now = new Date("2026-11-21T17:40:00Z");
  const hero = (games: number, from: Snapshot["matchupsFrom"]): Snapshot =>
    ({
      generatedAt: "x",
      heroes: {},
      bracketStats: {},
      laneRoles: {},
      matchups: { "1": { "2": { games, wins: 1 } } },
      synergy: {},
      matchupsFrom: from,
    }) as Snapshot;

  it("uses the snapshot's own counts when they are STRATZ's alone", async () => {
    const asked: string[] = [];
    const found = await lastStratzCounts(hero(10, { source: "stratz", at: "2026-11-20T18:38:34Z" }), now, async (path) => {
      asked.push(path);
      return null;
    });
    expect(found?.counts.matchups["1"]?.["2"]?.games).toBe(10);
    expect(found?.at.toISOString()).toBe("2026-11-20T18:38:34.000Z");
    expect(asked).toEqual([]);
  });

  it("goes back through the daily copies past ones that already hold patch games", async () => {
    const copies: Record<string, Snapshot> = {
      "daily/2026-11-21.json": hero(20, { source: "stratz", at: "2026-11-21T10:00:00Z", patchGames: 900_000 }),
      "daily/2026-11-19.json": hero(30, { source: "stratz", at: "2026-11-19T10:00:00Z" }),
    };
    const found = await lastStratzCounts(
      hero(40, { source: "stratz", at: "2026-11-21T17:00:00Z", patchGames: 950_000 }),
      now,
      async (path) => copies[path] ?? null,
    );
    expect(found?.counts.matchups["1"]?.["2"]?.games).toBe(30);
    expect(found?.at.toISOString()).toBe("2026-11-19T10:00:00.000Z");
  });

  it("gives null when no copy has STRATZ's counts alone", async () => {
    const blended = hero(40, { source: "stratz", at: "", patchGames: 1 });
    expect(await lastStratzCounts(blended, now, async () => blended)).toBeNull();
  });
});
