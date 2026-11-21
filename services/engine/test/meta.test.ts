import { describe, expect, it } from "vitest";
import { addRows, BASE_DAYS, roleShares, buildMeta, dayIndexes, daysQuery, gamesOf, runs, SETTLE_S, toHeroRows, WINDOW_DAYS, type MetaFile } from "../src/data/meta";

const DAY = 24 * 60 * 60;
const START = Date.parse("2026-11-18T21:28:07Z") / 1000;
const PATCH = { name: "7.42", startedAt: "2026-11-18T21:28:07.000Z" };

describe("toHeroRows", () => {
  it("reads numbers and numeric text, and drops odd rows", () => {
    expect(
      toHeroRows([
        { d: 0, g: 3, h: 1, games: 10, wins: 6 },
        { d: "1", g: "0", h: "5", games: "4", wins: "1" },
        { d: 0, g: 5, h: 1, games: 10, wins: 6 }, // no such rank group
        { d: 0, g: 1, h: 0, games: 10, wins: 6 }, // no hero
        { d: 0, g: 1, h: 2, games: 3, wins: 4 }, // more wins than games
        { d: -1, g: 1, h: 2, games: 3, wins: 1 },
        null,
      ]),
    ).toEqual([
      { d: 0, g: 3, h: 1, games: 10, wins: 6 },
      { d: 1, g: 0, h: 5, games: 4, wins: 1 },
    ]);
  });

  it("throws when the answer has no rows", () => {
    expect(() => toHeroRows(undefined)).toThrow("no rows");
  });
});

describe("addRows and gamesOf", () => {
  it("adds every row to every rank, and to its rank group when known", () => {
    const day = { heroes: {} };
    addRows(day, [
      { g: 3, h: 1, games: 10, wins: 6 },
      { g: 0, h: 1, games: 5, wins: 1 },
      { g: 3, h: 2, games: 10, wins: 4 },
    ]);
    expect(day.heroes).toEqual({ 1: [15, 7, 0, 0, 0, 0, 10, 6, 0, 0], 2: [10, 4, 0, 0, 0, 0, 10, 4, 0, 0] });
    // Ten heroes a game.
    expect(gamesOf(day.heroes)).toEqual([3, 0, 0, 2, 0]);
  });
});

describe("dayIndexes", () => {
  it("keeps the patch's days so far and the days before it", () => {
    expect(dayIndexes(START, START + 2.5 * DAY)).toEqual({ days: [0, 1, 2], base: [-7, -6, -5, -4, -3, -2, -1] });
  });

  it("keeps only the newest WINDOW_DAYS of an older patch", () => {
    const { days, base } = dayIndexes(START, START + 30.2 * DAY);
    expect(days).toHaveLength(WINDOW_DAYS);
    expect(days.at(-1)).toBe(30);
    expect(base).toHaveLength(BASE_DAYS);
  });

  it("has no patch days before the patch starts", () => {
    expect(dayIndexes(START, START - 10).days).toEqual([]);
  });
});

describe("roleShares", () => {
  it("turns position counts into whole percent shares", () => {
    expect(roleShares({ 32: [370, 250, 130, 140, 110], 1: [0, 0, 0, 0, 0], 2: [1, 2] })).toEqual({ 32: [37, 25, 13, 14, 11] });
    expect(roleShares(undefined)).toEqual({});
  });
});

describe("runs", () => {
  it("groups consecutive indexes", () => {
    expect(runs([-7, -6, -5, 0, 2, 3])).toEqual([
      [-7, -5],
      [0, 0],
      [2, 3],
    ]);
    expect(runs([])).toEqual([]);
  });
});

describe("daysQuery", () => {
  it("counts one side's heroes per day and rank group in one slice of ranked All Pick games", () => {
    const sql = daysQuery(100, 200, "dire", 4, 1);
    expect(sql).toContain("unnest(m.dire_team) h");
    expect(sql).toContain("not m.radiant_win");
    expect(sql).toContain("m.start_time >= 100 and m.start_time < 200");
    expect(sql).toContain("floor((m.start_time - 100) / 86400)::int as d");
    expect(sql).toContain("m.match_id % 4 = 1");
    expect(sql).toContain("group by 1, 2, 3");
  });
});

/** A fake explorer: every query answers one row per day in its range, hero 1 in Legend and Ancient. */
function fakeAsk() {
  const queries: string[] = [];
  const ask = async (sql: string) => {
    queries.push(sql);
    const [, from, to] = /start_time >= (\d+) and m\.start_time < (\d+)/.exec(sql) ?? [];
    const days = Math.ceil((Number(to) - Number(from)) / DAY);
    return Array.from({ length: days }, (_, d) => ({ d, g: 3, h: 1, games: 10, wins: sql.includes("not m.radiant_win") ? 4 : 6 }));
  };
  return { ask, queries };
}

describe("buildMeta", () => {
  const now = START + 2.5 * DAY;

  it("reads the days before the patch and the patch's days, each run of days together", async () => {
    const { ask, queries } = fakeAsk();
    const meta = await buildMeta(ask, PATCH, now, null);
    expect(meta.base.map((d) => d.index)).toEqual([-7, -6, -5, -4, -3, -2, -1]);
    expect(meta.days.map((d) => d.index)).toEqual([0, 1, 2]);
    // 3 days of about GAMES_PER_DAY games make 4 slices a side, each with 10 games of hero 1.
    expect(queries.filter((q) => q.includes(`>= ${Math.floor(START)} `))).toHaveLength(8);
    expect(meta.days[0]?.heroes[1]).toEqual([80, 40, 0, 0, 0, 0, 80, 40, 0, 0]);
    expect(meta.days[0]?.games).toEqual([8, 0, 0, 8, 0]);
    // The newest day is under way; a day counts as complete SETTLE_S after it ends.
    expect(meta.days.map((d) => d.complete)).toEqual([true, now >= START + 2 * DAY + SETTLE_S, false]);
    expect(meta.days[2]?.from).toBe(new Date((START + 2 * DAY) * 1000).toISOString());
    // The newest query stops at now.
    expect(queries.at(-1)).toContain(`m.start_time < ${Math.floor(now)}`);
    expect(meta.computedAt).toBe(new Date(now * 1000).toISOString());
    expect(meta.roles).toEqual({});
  });

  it("keeps complete days of the same patch and reads only the rest", async () => {
    const first = await buildMeta(fakeAsk().ask, PATCH, now, null);
    const { ask, queries } = fakeAsk();
    const later = now + 0.6 * DAY;
    const meta = await buildMeta(ask, PATCH, later, first);
    expect(meta.days.map((d) => d.index)).toEqual([0, 1, 2, 3]);
    // Days -7 to 1 were complete: only days 2 and 3 are read, in one range starting at day 2.
    expect(queries.every((q) => q.includes(`m.start_time >= ${Math.floor(START + 2 * DAY)}`))).toBe(true);
    expect(meta.base).toEqual(first.base);
  });

  it("reads every day again for a new patch", async () => {
    const first = await buildMeta(fakeAsk().ask, PATCH, now, null);
    const { ask, queries } = fakeAsk();
    const other: MetaFile = { ...first, patch: { name: "7.41", startedAt: "2026-10-01T00:00:00.000Z" } };
    await buildMeta(ask, PATCH, now, other);
    expect(queries.some((q) => q.includes(`m.start_time >= ${Math.floor(START - 7 * DAY)}`))).toBe(true);
  });

  it("throws when a query fails, so no partial day is published", async () => {
    await expect(buildMeta(async () => ({ not: "rows" }), PATCH, now, null)).rejects.toThrow("no rows");
  });

  it("throws on a patch without a start time", async () => {
    await expect(buildMeta(fakeAsk().ask, { name: "7.42", startedAt: "" }, now, null)).rejects.toThrow("no start time");
  });
});
