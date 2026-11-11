import { describe, expect, it } from "vitest";
import { Engine } from "../src/engine/score";
import type { ThreatPlan } from "../src/engine/threat";
import { draftThreats, MIN_PACE_GAMES, threatLanes, threatPace } from "../src/engine/threat-plan";
import type { Snapshot } from "../src/engine/types";
import { fixture } from "./fixture";

const step = (games: number, winRate: number) => ({ games, winRate });

/** A plan for `hero` with these answers (heroes from the fixture). */
const plan = (hero: number, answers: number[], drop: number): ThreatPlan => ({
  hero,
  answers: answers.map((h) => ({ hero: h, gap: -4 })),
  stair: [step(5000, 56), step(4000, 51), step(1000, 45)],
  drop,
  dropLow: drop - 2,
  length: [step(100, 44), step(100, 50), step(100, 55), step(100, 58), step(100, 60)],
});

/**
 * Carry One (1) is dangerous; his answers are Mid Three (3), Support Four (4), Offlane Five (5) and Offlane
 * Seven (7). The pick engine agrees on Offlane Five (he wins 40% against it) but not on Support Four (52%).
 */
function data(): Snapshot {
  const d = fixture();
  d.matchups[1] = { 5: { games: 1000, wins: 400 }, 4: { games: 1000, wins: 520 }, 7: { games: 1000, wins: 450 } };
  d.threatPlans = { at: "", games: 1, plans: [plan(1, [3, 4, 5, 7], 10)], pos1Length: [step(1000, 47)] };
  return d;
}

describe("draftThreats", () => {
  it("gives the plan for a dangerous enemy core: your answers, your step and open answers per empty seat", () => {
    const { main, others } = draftThreats(new Engine(data()), { allies: [{ heroId: 3, position: 2 }], enemies: [1] });
    expect(main?.hero).toBe(1);
    expect(main?.position).toBe(1);
    expect(main?.have.map((a) => a.hero)).toEqual([3]);
    expect(main?.step).toBe(1);
    // Mid is taken. Support Four is left out: the pick engine says he does better against it.
    expect(main?.open).toEqual([
      {
        position: 3,
        heroes: [
          { hero: 5, edge: expect.any(Number) },
          { hero: 7, edge: expect.any(Number) },
        ],
      },
    ]);
    expect(main!.open[0]!.heroes[0]!.edge).toBeLessThan(main!.open[0]!.heroes[1]!.edge);
    expect(main?.length.group).toEqual([step(1000, 47)]);
    expect(others).toEqual([]);
  });

  it("shows an answer once, at the empty seat he is played at most", () => {
    const d = data();
    // Now the engine agrees on Support Four, who plays pos 4 and 5 as often (the first wins the tie).
    d.matchups[1] = { 4: { games: 1000, wins: 420 }, 5: { games: 1000, wins: 400 }, 7: { games: 1000, wins: 380 } };
    const { main } = draftThreats(new Engine(d), { allies: [{ heroId: 3, position: 2 }], enemies: [1] });
    expect(main?.open.map((s) => [s.position, s.heroes.map((a) => a.hero)])).toEqual([
      [3, [5, 7]],
      [4, [4]],
    ]);
  });

  it("counts two or more answers as the last step and leaves out taken heroes", () => {
    const { main } = draftThreats(new Engine(data()), {
      allies: [{ heroId: 3, position: 2 }, { heroId: 5, position: 3 }],
      enemies: [1],
      bans: [7],
    });
    expect(main?.step).toBe(2);
    expect(main?.open).toEqual([]);
  });

  it("gives no plan for an enemy support or without plans", () => {
    const d = data();
    d.threatPlans!.plans = [plan(6, [3], 10)];
    expect(draftThreats(new Engine(d), { allies: [], enemies: [6] }).main).toBeUndefined();
    delete d.threatPlans;
    expect(draftThreats(new Engine(d), { allies: [], enemies: [1] })).toEqual({ others: [] });
  });

  it("gives the full plan to the biggest drop and one line to the others", () => {
    const d = data();
    d.threatPlans!.plans = [plan(1, [3, 5], 10), plan(2, [5], 8)];
    const { main, others } = draftThreats(new Engine(d), { allies: [{ heroId: 5, position: 3 }], enemies: [2, 1] });
    expect(main?.hero).toBe(1);
    expect(others).toEqual([{ hero: 2, step: 1 }]);
  });
});

describe("threatLanes", () => {
  it("shows his lane with each of your laners in it, from your rank group when it has the pair", () => {
    const d = data();
    d.laneOutcomes = {
      "0": { 1: { 5: [1000, 300, 200, 500], 7: [1000, 500, 200, 300] } },
      "4": { 1: { 5: [400, 100, 100, 200] } },
    };
    const allies = [{ heroId: 5, position: 3 as const }, { heroId: 7, position: 3 as const }, { heroId: 6 }, { heroId: 2, position: 2 as const }];
    // Pos 3 laners face his pos 1; Mid Two does not, and Support Six has no position.
    expect(threatLanes(new Engine(d), 1, 1, allies, 7)).toEqual([
      { ally: 5, with: [400, 100, 100, 200], usual: [400, 100, 100, 200] },
      { ally: 7, with: [1000, 500, 200, 300], usual: [2000, 800, 400, 800] },
    ]);
  });
});

describe("threatPace", () => {
  const withPace = (minutes: [number, number, number][]) => {
    const d = data();
    d.items = { 147: { key: "manta", name: "Manta Style", cost: 4650, img: "", components: [] } };
    d.itemTimings = { 1: { 1: { all: { games: 5000, items: [[147, 16, 18]], pace: { itemId: 147, minutes } } } } };
    return new Engine(d);
  };

  it("sums games done early and late against his usual minute", () => {
    const pace = threatPace(withPace([[13, 200, 150], [14, 300, 200], [16, 1000, 500], [17, 300, 120], [19, 300, 130], [20, 300, 160]]), 1, 1);
    expect(pace?.minute).toBe(16);
    expect(pace?.early).toEqual({ games: 500, winRate: 70 });
    expect(pace?.late).toEqual({ games: 600, winRate: 41.7 });
  });

  it("is undefined when early or late has too few games", () => {
    expect(threatPace(withPace([[14, MIN_PACE_GAMES - 1, 200], [16, 1000, 500], [17, 400, 200]]), 1, 1)).toBeUndefined();
  });
});
