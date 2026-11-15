import { describe, expect, it } from "vitest";
import { draftAt } from "../src/backtest/backtest";
import { EXAMPLES, liftOf, pickRecords, proofOf, RUNNING_MIN_PICKS, type PickRecord } from "../src/backtest/proof";
import type { EvalMatch } from "../src/data/eval-matches";
import { Engine } from "../src/engine/score";
import type { Position } from "../src/engine/types";
import { fixture } from "./fixture";

const DAY = 24 * 60 * 60;
const nov1 = Date.parse("2026-11-01T12:00:00Z") / 1000;

/** A scored pick; `engineAt` is where the engine ranked it (-1: not in its top 8). */
function record(over: Partial<PickRecord> & { engineAt?: number } = {}): PickRecord {
  const { engineAt = -1, ...rest } = over;
  return {
    matchId: 1,
    startTime: nov1,
    rankTier: 54,
    heroId: 1,
    position: 1,
    round: 0,
    won: true,
    engineFirst: 1,
    at: { engine: engineAt, meta: -1, popular: -1 },
    ...rest,
  };
}

describe("liftOf", () => {
  it("compares picks in the top 3 with the rest, with a 95% margin", () => {
    const records = [
      ...Array.from({ length: 60 }, (_, i) => record({ engineAt: i % 3, won: i < 36 })),
      ...Array.from({ length: 140 }, (_, i) => record({ engineAt: i % 2 ? 5 : -1, won: i < 70 })),
    ];
    const lift = liftOf(records);
    expect(lift.top3).toEqual({ picks: 60, won: 0.6 });
    expect(lift.other).toEqual({ picks: 140, won: 0.5 });
    expect(lift.lift).toBeCloseTo(0.1, 4);
    const se = Math.sqrt((0.6 * 0.4) / 60 + (0.5 * 0.5) / 140);
    expect(lift.margin).toBeCloseTo(1.96 * se, 4);
  });

  it("has no lift when a group is empty", () => {
    expect(liftOf([record({ engineAt: 0 })]).lift).toBeNull();
    expect(liftOf([record({ engineAt: 0 })]).margin).toBeNull();
  });

  it("scores each rival by its own ranks", () => {
    const r = [record({ at: { engine: -1, meta: 0, popular: -1 } }), record({ won: false })];
    expect(liftOf(r, "meta").lift).toBe(1);
    expect(liftOf(r, "engine").lift).toBeNull();
  });
});

describe("proofOf", () => {
  it("is null with no picks", () => {
    expect(proofOf([], "now")).toBeNull();
  });

  // 20 days, 10 games a day, 10 picks a game; a third of picks in the top 3, winning 60% against 50%.
  const records: PickRecord[] = [];
  for (let d = 0; d < 20; d++) {
    for (let g = 0; g < 10; g++) {
      for (let p = 0; p < 10; p++) {
        const n = (d * 10 + g) * 10 + p;
        const top = n % 3 === 0;
        records.push(
          record({
            matchId: d * 100 + g,
            startTime: nov1 + d * DAY + g * 60,
            rankTier: [15, 35, 55, 75, null][g % 5]!,
            heroId: (n % 40) + 1,
            position: ((p % 5) + 1) as Position,
            round: (p % 3) as 0 | 1 | 2,
            engineAt: top ? n % 2 : 6,
            won: top ? n % 5 < 3 : n % 2 === 0,
          }),
        );
      }
    }
  }
  const proof = proofOf(records, "2026-11-21T03:00:00Z")!;

  it("counts games, picks and days", () => {
    expect(proof).toMatchObject({ from: "2026-11-01", to: "2026-11-20", games: 200, picks: 2000 });
    expect(proof.rivals.engine.top3.picks).toBe(667);
    expect(proof.rivals.engine.hitTop8).toBe(1);
    expect(proof.rivals.meta.lift).toBeNull();
  });

  it("starts the running line once the top 3 has enough picks, one point a day", () => {
    const first = proof.running[0]!;
    expect(first.day).toBe("2026-11-05");
    expect(liftOf(records.filter((r) => r.startTime < Date.parse("2026-11-05T00:00:00Z") / 1000)).top3.picks).toBeLessThan(RUNNING_MIN_PICKS);
    expect(proof.running.at(-1)).toMatchObject({ day: "2026-11-20", games: 200, lift: proof.rivals.engine.lift });
  });

  it("splits by rank group, position and round, leaving out games with no rank", () => {
    expect(Object.keys(proof.byRank)).toEqual(["1", "2", "3", "4"]);
    expect(Object.values(proof.byRank).reduce((n, l) => n + l.top3.picks + l.other.picks, 0)).toBe(1600);
    expect(Object.keys(proof.byRole)).toEqual(["1", "2", "3", "4", "5"]);
    expect(Object.keys(proof.byRound)).toEqual(["0", "1", "2"]);
  });

  it("shows the newest picks of the engine's first choice, one per hero, wins and losses alike", () => {
    expect(proof.examples).toHaveLength(EXAMPLES);
    expect(new Set(proof.examples.map((e) => e.heroId)).size).toBe(EXAMPLES);
    const firsts = records.filter((r) => r.at.engine === 0).sort((a, b) => b.startTime - a.startTime);
    expect(proof.examples[0]!.matchId).toBe(firsts[0]!.matchId);
    for (let i = 1; i < proof.examples.length; i++) expect(proof.examples[i]!.startTime).toBeLessThanOrEqual(proof.examples[i - 1]!.startTime);
  });
});

describe("pickRecords", () => {
  const engine = new Engine(fixture());
  const game: EvalMatch = {
    id: 7,
    startTime: nov1,
    rankTier: 55,
    radiantWin: false,
    bans: [],
    picks: [
      { heroId: 1, radiant: true, position: 1 },
      { heroId: 2, radiant: false, position: 2 },
      { heroId: 3, radiant: false, position: null },
      { heroId: 5, radiant: true, position: 3 },
      { heroId: 4, radiant: true, position: 4 },
      { heroId: 6, radiant: false, position: 5 },
      { heroId: 7, radiant: false, position: 3 },
    ],
  };
  const records = pickRecords(engine, [game]);

  it("scores each pick with a known position, with its team's round and result", () => {
    expect(records.map((r) => r.heroId)).toEqual([1, 2, 5, 4, 6, 7]);
    // Dire's picks are its 1st, 2nd (hero 3, no position), 3rd and 4th: rounds 0, 1, 1.
    expect(records.map((r) => r.round)).toEqual([0, 0, 0, 1, 1, 1]);
    expect(records.map((r) => r.won)).toEqual([false, true, false, false, true, true]);
  });

  it("ranks the pick in the engine's own list", () => {
    for (const r of records) {
      const index = game.picks.findIndex((p) => p.heroId === r.heroId);
      const list = engine.suggest(draftAt(game, index)!).map((s) => s.heroId);
      expect(r.at.engine).toBe(list.indexOf(r.heroId));
      expect(r.engineFirst).toBe(list[0] ?? null);
    }
  });
});
