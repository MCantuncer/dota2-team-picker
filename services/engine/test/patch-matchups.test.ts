import { describe, expect, it } from "vitest";
import {
  addVs,
  addWith,
  blendCounts,
  fetchPatchCounts,
  letterPatchStart,
  recentStart,
  GAMES_PER_DAY_GUESS,
  MAX_RECENT_SLICES,
  RECENT_WEIGHT,
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

  it("finds the newest letter patch of the snapshot's patch", () => {
    const patch = { name: "7.42", startedAt: "2026-11-18T21:28:07Z" };
    const release = { name: "7.42a", startedAt: "2026-11-24T23:40:00Z", from: "valve" as const };
    expect(letterPatchStart({ ...patch, release })).toBe(Date.parse(release.startedAt) / 1000);
    expect(letterPatchStart({ ...patch, release: { ...release, name: "7.42" } })).toBeUndefined();
    expect(letterPatchStart({ ...patch, release: { ...release, startedAt: "2026-11-01T00:00:00Z" } })).toBeUndefined();
    expect(letterPatchStart(patch)).toBeUndefined();
  });

  it("calls a patch fresh for its first 14 days", () => {
    const start = Date.parse("2026-11-18T21:28:07Z") / 1000;
    expect(patchIsFresh(start, new Date("2026-11-21T10:00:00Z"))).toBe(true);
    expect(patchIsFresh(start, new Date("2026-12-03T10:00:00Z"))).toBe(false);
  });
});

describe("fetchPatchCounts", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  /** Two days after the test patch started at Unix second 0: all of it is recent, read once. */
  const NOW = new Date(2 * DAY_MS);
  /** Ten days after: the last two days are read again. */
  const LATER = new Date(10 * DAY_MS);
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
    // 2 days at GAMES_PER_DAY_GUESS: 5 slices, of which MAX_SLICES are read.
    const slices = Math.ceil((2 * GAMES_PER_DAY_GUESS) / GAMES_PER_SLICE);
    expect(asked.filter((q) => q.includes(`% ${slices} = `))).toHaveLength(3 * MAX_SLICES);
    expect(asked).toHaveLength(2 + 3 * MAX_SLICES);
    expect(games).toBe(MAX_SLICES);
  });

  it("reads the last RECENT_DAYS again so their games count RECENT_WEIGHT times", async () => {
    // 2.5M games in the patch (10 slices, 4 read: share 0.4); 1M recent (4 slices, 2 read: share 0.5).
    const asked: string[] = [];
    const get = async <T>(path: string): Promise<T> => {
      const sql = decodeURIComponent(path.replace("/explorer?sql=", ""));
      asked.push(sql);
      const recent = !sql.includes("m.start_time >= 0 ");
      if (sql.startsWith("select count(*)")) return { rows: [{ games: recent ? 1_000_000 : 2_500_000 }] } as T;
      const vs = sql.includes("unnest(m.dire_team) b");
      return { rows: [vs ? { ...vsRow, games: recent ? 50 : 100, wins: recent ? 10 : 50 } : withRow] } as T;
    };
    const { counts, games, recentGames } = await fetchPatchCounts(get, 0, LATER);
    expect(asked).toHaveLength(1 + 3 * MAX_SLICES + 1 + 3 * MAX_RECENT_SLICES);
    expect(asked.filter((q) => q.includes(`m.start_time >= ${8 * 24 * 60 * 60} `))).toHaveLength(1 + 3 * MAX_RECENT_SLICES);
    // Extra share (3 - 1) x 0.4 / 0.5 = 1.6: 4 x 100 + 1.6 x 2 x 50 games, 4 x 50 + 1.6 x 2 x 10 wins.
    expect(RECENT_WEIGHT).toBe(3);
    expect(counts.matchups[1]?.[2]).toEqual({ games: 560, wins: 232 });
    expect(games).toBe(16);
    expect(recentGames).toBe(4);
  });

  it("counts the games since a fresh letter patch extra, instead of the last days", async () => {
    const { get, asked } = fakeExplorer(10);
    const letter = 5 * 24 * 60 * 60;
    const { since } = await fetchPatchCounts(get, 0, LATER, letter);
    expect(since).toBe("letter");
    expect(asked.filter((q) => q.includes(`m.start_time >= ${letter} `))).toHaveLength(1 + 3);
    // A letter patch older than PATCH_FRESH_DAYS goes back to the last days.
    expect(recentStart(letter, new Date(letter * 1000 + 20 * DAY_MS)).since).toBe("days");
  });

  it("counts every game once when the recent read fails", async () => {
    const { get } = fakeExplorer(10, (sql) => !sql.includes("m.start_time >= 0 "));
    const { counts, recentGames } = await fetchPatchCounts(get, 0, LATER);
    expect(recentGames).toBe(0);
    expect(counts.matchups[1]?.[2]).toEqual({ games: 25, wins: 10 });
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
