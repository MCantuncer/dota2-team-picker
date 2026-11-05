import { describe, expect, it } from "vitest";
import { fetchLaneOutcomes, LANE_HEROES_PER_QUERY, laneQuery, lanesDue, MIN_LANE_GAMES, toLaneOutcomes } from "../src/data/stratz-lanes";
import { fixture } from "./fixture";

const HEROES = [1, 2, 3];
/** Hero `id`'s lane rows against the others: 1000 games, 400 won (50 of them stomps), 250 drawn, 350 lost. */
const rows = (id: number) =>
  HEROES.filter((o) => o !== id).map((o) => ({
    heroId1: id,
    heroId2: o,
    matchCount: 1000,
    winCount: 350,
    stompWinCount: 50,
    drawCount: 250,
    lossCount: 300,
    stompLossCount: 50,
  }));
const answers = () => Object.fromEntries(HEROES.flatMap((id) => [0, 1, 2, 3, 4].map((g) => [`l${id}_${g}`, rows(id)])));

describe("laneQuery", () => {
  it("asks for every hero against others, all ranks and each rank group", () => {
    const q = laneQuery([8, 2]);
    expect(q).toContain("l8_0: laneOutcome(heroId: 8, isWith: false)");
    expect(q).toContain("l8_3: laneOutcome(heroId: 8, isWith: false, bracketBasicIds: [LEGEND_ANCIENT])");
    expect(q).toContain("stompWinCount");
    expect(q.match(/laneOutcome\(/g)).toHaveLength(10);
  });

  it("refuses an empty, too big or bad batch", () => {
    expect(() => laneQuery([])).toThrow();
    expect(() => laneQuery(Array.from({ length: LANE_HEROES_PER_QUERY + 1 }, (_, i) => i + 1))).toThrow();
    expect(() => laneQuery([1.5])).toThrow();
  });
});

describe("toLaneOutcomes", () => {
  it("counts stomps in won and lost, for all ranks and each rank group", () => {
    const l = toLaneOutcomes(HEROES, answers());
    expect(l["0"]!["1"]!["2"]).toEqual([1000, 400, 250, 350]);
    expect(l["3"]!["2"]!["3"]).toEqual([1000, 400, 250, 350]);
    expect(Object.keys(l).sort()).toEqual(["0", "1", "2", "3", "4"]);
  });

  it("leaves out pairs with too few games, bad numbers or the hero itself", () => {
    const a = answers();
    a["l1_0"] = [
      { ...rows(1)[0]!, matchCount: MIN_LANE_GAMES - 1, winCount: 10, stompWinCount: 0, drawCount: 10, lossCount: 10, stompLossCount: 0 },
      { ...rows(1)[1]!, winCount: 900 },
      { ...rows(1)[1]!, heroId2: 1 },
    ];
    a["l1_0"].push({ ...rows(1)[1]! });
    const l = toLaneOutcomes(HEROES, a);
    expect(Object.keys(l["0"]!["1"]!)).toEqual(["3"]);
  });

  it("throws on a missing slice, so a partial answer never replaces the counts", () => {
    const a = answers();
    delete a["l3_2"];
    expect(() => toLaneOutcomes(HEROES, a)).toThrow(/hero 3, slice 2/);
  });

  it("throws when all ranks covers too few heroes, but not when a rank group does", () => {
    const thinGroup = answers();
    thinGroup["l1_1"] = [];
    expect(() => toLaneOutcomes(HEROES, thinGroup)).not.toThrow();
    const thinAll = answers();
    thinAll["l1_0"] = [];
    expect(() => toLaneOutcomes(HEROES, thinAll)).toThrow(/hero 1 has 0 pairs/);
  });
});

describe("fetchLaneOutcomes", () => {
  it("asks in batches and fails without heroStats", async () => {
    const queries: string[] = [];
    const l = await fetchLaneOutcomes(HEROES, async (q) => {
      queries.push(q);
      return { heroStats: answers() };
    });
    expect(queries).toHaveLength(1);
    expect(l["0"]!["3"]!["1"]).toEqual([1000, 400, 250, 350]);
    await expect(fetchLaneOutcomes(HEROES, async () => ({}))).rejects.toThrow(/no heroStats/);
  });
});

describe("lanesDue", () => {
  const now = new Date("2026-11-05T12:00:00Z");
  it("is due when missing or a week old", () => {
    const snap = fixture();
    expect(lanesDue(snap, now)).toBe(true);
    snap.laneOutcomes = {};
    snap.laneOutcomesAt = "2026-11-01T12:00:00Z";
    expect(lanesDue(snap, now)).toBe(false);
    snap.laneOutcomesAt = "2026-10-29T12:00:00Z";
    expect(lanesDue(snap, now)).toBe(true);
  });
});
