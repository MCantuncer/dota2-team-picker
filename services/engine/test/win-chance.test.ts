import { describe, expect, it } from "vitest";
import { checkToMarkdown, checkWinModel, fitLogistic, fitWinModel, samplesOf, type Sample } from "../src/backtest/win-fit";
import type { EvalMatch } from "../src/data/eval-matches";
import { Engine } from "../src/engine/score";
import { draftEdge, winChance, type WinModel } from "../src/engine/win-chance";
import { fixture } from "./fixture";

/** A deterministic stand-in for Math.random, so the synthetic games are the same every run. */
function random(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
}

/** Samples whose real win chance is exactly the logistic curve with these numbers. */
function synthetic(a: number, b: number, n: number, known = 10): Sample[] {
  const rnd = random(7);
  return Array.from({ length: n }, () => {
    const edge = (rnd() - 0.5) * 20;
    return { known, edge, won: rnd() < 1 / (1 + Math.exp(-(a + b * edge))) };
  });
}

describe("draftEdge", () => {
  const engine = new Engine(fixture());

  it("favours the side with the counter and is the same from the other side, reversed", () => {
    const edge = draftEdge(engine, [3], [5]);
    expect(edge).toBeGreaterThan(0);
    expect(draftEdge(engine, [5], [3])).toBeCloseTo(-edge, 6);
  });

  it("is zero for an empty or even draft", () => {
    expect(draftEdge(engine, [], [])).toBe(0);
    expect(draftEdge(engine, [4], [6])).toBeCloseTo(0, 6);
  });

  it("counts a hard counter's full gap once, from either side", () => {
    // Hero 2 is on the hand-checked list as a hard counter of hero 1 (gap 6.5).
    expect(draftEdge(engine, [1], [2])).toBeCloseTo(-6.5, 6);
    expect(draftEdge(engine, [2], [1])).toBeCloseTo(6.5, 6);
  });
});

describe("winChance", () => {
  const model: WinModel = { fittedAt: "", games: 1, byKnown: { 2: { a: 0, b: 0.1 }, 10: { a: 0, b: 0.2 } } };

  it("is hidden without a checked model or before the first fitted step", () => {
    expect(winChance(undefined, 5, 10)).toBeNull();
    expect(winChance(model, 5, 1)).toBeNull();
  });

  it("uses the curve for the nearest step at or below the heroes known", () => {
    expect(winChance(model, 0, 10)).toBeCloseTo(0.5);
    expect(winChance(model, 10, 10)).toBeCloseTo(1 / (1 + Math.exp(-2)));
    expect(winChance(model, 10, 7)).toBeCloseTo(1 / (1 + Math.exp(-1)));
  });
});

describe("fitLogistic", () => {
  it("finds the curve the games were drawn from", () => {
    const fit = fitLogistic(synthetic(0.1, 0.15, 20000));
    expect(fit.a).toBeCloseTo(0.1, 1);
    expect(fit.b).toBeCloseTo(0.15, 1);
  });

  it("stays flat when the edge says nothing", () => {
    const flat = synthetic(0, 0, 5000);
    expect(Math.abs(fitLogistic(flat).b)).toBeLessThan(0.02);
  });
});

describe("checkWinModel", () => {
  const truth = synthetic(0, 0.15, 20000);

  it("passes a model that matches how games really go", () => {
    const model = fitWinModel(truth.slice(0, 10000), "2026-10-26T00:00:00Z", 10000);
    const check = checkWinModel(model, truth.slice(10000));
    expect(check.passes).toBe(true);
    expect(check.logLoss).toBeLessThan(Math.LN2);
    expect(checkToMarkdown(check)).toContain("passed");
  });

  it("fails a model that is too sure of itself", () => {
    const overconfident: WinModel = { fittedAt: "", games: 1, byKnown: { 10: { a: 0, b: 0.6 } } };
    const check = checkWinModel(overconfident, truth);
    expect(check.passes).toBe(false);
    expect(checkToMarkdown(check)).toContain("stays hidden");
  });

  it("fails when there is nothing to judge", () => {
    expect(checkWinModel(fitWinModel([], "", 0), []).passes).toBe(false);
  });
});

describe("samplesOf", () => {
  it("gives one Radiant-side sample per draft step", () => {
    const game: EvalMatch = {
      id: 1,
      startTime: 0,
      rankTier: 54,
      radiantWin: true,
      picks: [3, 5, 1, 2, 4, 6, 7].map((heroId, i) => ({ heroId, radiant: i % 2 === 0, position: null })),
      bans: [],
    };
    const samples = samplesOf(new Engine(fixture()), [game]);
    expect(samples.map((s) => s.known)).toEqual([2, 4, 6, 8, 10]);
    // After 2 picks it is Mid Three (Radiant) against Offlane Five, which Radiant counters.
    expect(samples[0]!.edge).toBeGreaterThan(0);
    expect(samples.every((s) => s.won)).toBe(true);
  });
});
