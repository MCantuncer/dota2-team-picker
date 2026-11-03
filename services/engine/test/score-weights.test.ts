import { describe, expect, it } from "vitest";
import { fitAndCheck, fitWeights, PARTS, PRIOR_SLOPE, type PickSample } from "../src/backtest/score-weights";
import { Engine, HAND_WEIGHTS } from "../src/engine/score";
import type { DraftInput } from "../src/engine/types";
import { fixture } from "./fixture";

/** Picks whose win chance follows the given multipliers on each part. */
function synthetic(multipliers: number[], n: number): PickSample[] {
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: n }, () => {
    const parts = PARTS.map(() => (rand() - 0.5) * 20);
    const z = parts.reduce((t, x, i) => t + x * multipliers[i]! * PRIOR_SLOPE, 0);
    return { parts, won: rand() < 1 / (1 + Math.exp(-z)) };
  });
}

const draft: DraftInput = { myPosition: 1, allies: [{ heroId: 4, position: 5 }], enemies: [5, 6], count: 200 };

describe("learned score weights", () => {
  it("finds which parts really win games", () => {
    const truth = [2, 1, 0, 1, 1, 1, 1, 0.5];
    const weights = fitWeights(synthetic(truth, 40000));
    PARTS.forEach((p, i) => expect(weights[p]).toBeCloseTo(truth[i]!, 0));
  });

  it("stays at the hand-set weights with no games", () => {
    expect(fitWeights([])).toEqual(HAND_WEIGHTS);
  });

  it("keeps each weight between 0 and 3", () => {
    const weights = fitWeights(synthetic([6, -3, 1, 1, 1, 1, 1, 1], 40000));
    expect(weights.counter).toBe(3);
    expect(weights.synergy).toBe(0);
  });

  it("multiplies each part of the score by its weight", () => {
    const hand = new Engine(fixture(), { hardCounters: [], scoreWeights: null }).suggest(draft);
    const doubled = new Engine(fixture(), { hardCounters: [], scoreWeights: { ...HAND_WEIGHTS, counter: 2, meta: 0 } }).suggest(draft);
    for (const s of doubled) {
      const h = hand.find((x) => x.heroId === s.heroId)!;
      expect(s.breakdown.counter).toBeCloseTo(2 * h.breakdown.counter, 1);
      expect(s.breakdown.meta).toBe(0);
      expect(s.breakdown.synergy).toBe(h.breakdown.synergy);
    }
  });

  it("uses the snapshot's learned weights unless told to use the hand-set ones", () => {
    const data = fixture();
    data.scoreWeights = { fittedAt: "2026-11-03T00:00:00Z", picks: 1, lift: { learned: 3, hand: 1 }, weights: { ...HAND_WEIGHTS, meta: 0 } };
    expect(new Engine(data).partWeights.meta).toBe(0);
    expect(new Engine(data, { scoreWeights: null }).partWeights).toEqual(HAND_WEIGHTS);
  });

  it("doesn't fit with too few saved games", () => {
    const check = fitAndCheck(fixture(), []);
    expect(check.keep).toBe(false);
    expect(check.verdict).toContain("hand-set weights stay");
  });
});
