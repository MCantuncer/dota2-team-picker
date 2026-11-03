import { describe, expect, it } from "vitest";
import { decayCounts } from "../src/data/fetch";
import { applyStratzCounts, fetchStratzCounts, HEROES_PER_QUERY, matchUpQuery, toStratzCounts } from "../src/data/stratz-matchups";
import { Engine } from "../src/engine/score";
import { fixture } from "./fixture";

const HEROES = [1, 2, 3];
/** An answer row for `id`: games against and with each other hero, wins as given or half. */
const row = (id: number, wins: Record<number, number> = {}) => [
  {
    heroId: id,
    vs: HEROES.filter((o) => o !== id).map((o) => ({ heroId2: o, matchCount: 1000, winCount: wins[o] ?? 500 })),
    with: HEROES.filter((o) => o !== id).map((o) => ({ heroId2: o, matchCount: 800, winCount: 400 })),
  },
];
const answers = (heroes = HEROES) =>
  Object.fromEntries(heroes.flatMap((id) => [0, 1, 2, 3, 4].map((g) => [`h${id}_${g}`, row(id, id === 1 ? { 2: 390 } : id === 2 ? { 1: 610 } : {})])));

describe("matchUpQuery", () => {
  it("asks for every hero all ranks and each rank group", () => {
    const q = matchUpQuery([94, 88]);
    expect(q).toContain("h94_0: matchUp(heroId: 94, take: 200)");
    expect(q).toContain("h94_3: matchUp(heroId: 94, bracketBasicIds: [LEGEND_ANCIENT], take: 200)");
    expect(q).toContain("h88_4: matchUp(heroId: 88, bracketBasicIds: [DIVINE_IMMORTAL], take: 200)");
    expect(q.match(/matchUp\(/g)).toHaveLength(10);
  });

  it("refuses an empty, too big or bad batch", () => {
    expect(() => matchUpQuery([])).toThrow();
    expect(() => matchUpQuery(Array.from({ length: HEROES_PER_QUERY + 1 }, (_, i) => i + 1))).toThrow();
    expect(() => matchUpQuery([1.5])).toThrow();
  });
});

describe("toStratzCounts", () => {
  it("fills all ranks and each rank group, with each synergy pair once", () => {
    const c = toStratzCounts(HEROES, answers());
    expect(c.matchups[1]![2]).toEqual({ games: 1000, wins: 390 });
    expect(c.matchups[2]![1]).toEqual({ games: 1000, wins: 610 });
    expect(c.rankMatchups[3]![1]![2]).toEqual({ games: 1000, wins: 390 });
    expect(Object.keys(c.synergy).sort()).toEqual(["1-2", "1-3", "2-3"]);
    expect(Object.keys(c.rankSynergy)).toEqual(["1", "2", "3", "4"]);
  });

  it("throws on a missing hero or slice, so a partial answer never replaces the counts", () => {
    const partial = answers();
    delete partial["h3_2"];
    expect(() => toStratzCounts(HEROES, partial)).toThrow(/hero 3, slice 2/);
  });

  it("throws when a slice has pairs for too few heroes", () => {
    const thin = answers();
    thin["h1_0"] = [{ heroId: 1, vs: [], with: [] }];
    expect(() => toStratzCounts(HEROES, thin)).toThrow(/0 pairs/);
  });

  it("drops rows with bad numbers", () => {
    const bad = answers();
    bad["h1_0"] = [{ heroId: 1, vs: [{ heroId2: 2, matchCount: 10, winCount: 20 }, { heroId2: 3, matchCount: 1000, winCount: 500 }, { heroId2: 1, matchCount: 5, winCount: 1 }], with: [] }];
    const c = toStratzCounts([1, 2], { ...bad });
    expect(c.matchups[1]).toEqual({ 3: { games: 1000, wins: 500 } });
  });
});

describe("fetchStratzCounts", () => {
  it("asks in batches and builds the counts", async () => {
    const queries: string[] = [];
    const c = await fetchStratzCounts(HEROES, async (q) => {
      queries.push(q);
      return { heroStats: answers() };
    });
    expect(queries).toHaveLength(1);
    expect(c.matchups[1]![2]!.wins).toBe(390);
  });

  it("fails when STRATZ gives no heroStats", async () => {
    await expect(fetchStratzCounts(HEROES, async () => ({}))).rejects.toThrow(/no heroStats/);
  });
});

describe("applyStratzCounts", () => {
  it("replaces every count field, marks the source, and the engine reads the new counter", () => {
    const snap = fixture();
    snap.heroes = Object.fromEntries(Object.entries(snap.heroes).filter(([id]) => HEROES.includes(Number(id))));
    applyStratzCounts(snap, toStratzCounts(HEROES, answers()), new Date("2026-11-03T12:00:00Z"));
    expect(snap.matchupsFrom).toEqual({ source: "stratz", at: "2026-11-03T12:00:00.000Z" });
    expect(snap.matchups[1]![2]).toEqual({ games: 1000, wins: 390 });
    const engine = new Engine(snap, { hardCounters: [] });
    expect(engine.matchupEdge(1, 2)).toBeLessThan(-5);
    expect(engine.matchupEdge(2, 1)).toBeGreaterThan(5);
  });

  it("never fades STRATZ counts", () => {
    const snap = fixture();
    snap.generatedAt = "2026-11-01T00:00:00Z";
    applyStratzCounts(snap, toStratzCounts(HEROES, answers()), new Date("2026-11-03T00:00:00Z"));
    decayCounts(snap, new Date("2026-11-03T00:00:00Z"));
    expect(snap.matchups[1]![2]).toEqual({ games: 1000, wins: 390 });
  });
});
