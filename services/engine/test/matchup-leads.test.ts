import { describe, expect, it } from "vitest";
import { seeded } from "../src/engine/item-odds";
import { leadGap, MIN_RESULT_GAMES, placeboDraft } from "../src/engine/matchup-leads";
import type { MatchupGame } from "../src/engine/matchup-talents";

let nextMatch = 1;
/** A game whose lead is `at10` at minute 10 and twice that at 20. */
function game(won: boolean, at10: number): MatchupGame {
  const lead = Array.from({ length: 21 }, (_, m) => (at10 * m) / 10);
  return { match: nextMatch++, account: nextMatch, won, level: 25, version: 190, points: [], lead };
}

/** `n` wins and `n` losses, leads spread by ±`spread` around the given means. */
function games(n: number, winMean: number, lossMean: number, spread = 400): MatchupGame[] {
  return Array.from({ length: n }, (_, i) => {
    const wobble = (i % 2 ? 1 : -1) * spread;
    return [game(true, winMean + wobble), game(false, lossMean + wobble)];
  }).flat();
}

describe("leadGap", () => {
  it("compares wins with wins and losses with losses", () => {
    // Usual: wins +2k, losses -2k at 10. This lineup: both results 1k lower.
    const others = games(100, 2000, -2000);
    const draft = games(20, 1000, -3000);
    const at10 = leadGap(draft, others, 10);
    expect(at10.gap).toBeCloseTo(-1000);
    expect(at10.games).toBe(40);
    expect(at10.shows).toBe(true);
    // At 20 the gap doubles with the leads.
    expect(leadGap(draft, others, 20).gap).toBeCloseTo(-2000);
  });

  it("is not fooled by a lineup that only changes the share of wins", () => {
    // Same leads inside each result, but three wins for every loss.
    const others = games(100, 2000, -2000);
    const draft = [...games(20, 2000, -2000).filter((g) => g.won), ...games(20, 2000, -2000).filter((g) => g.won), ...games(10, 2000, -2000).filter((g) => !g.won)];
    const gap = leadGap(draft, others, 10);
    expect(Math.abs(gap.gap)).toBeLessThan(1);
    expect(gap.shows).toBe(false);
  });

  it("stays quiet when a gap is too small to matter", () => {
    const gap = leadGap(games(30, 1700, -2300, 50), games(100, 2000, -2000, 50), 10);
    expect(gap.gap).toBeCloseTo(-300);
    expect(gap.shows).toBe(false);
  });

  it("stays quiet when the gap is inside the noise", () => {
    // A 600 gap with leads spread by ±4k on 15 games a result.
    const gap = leadGap(games(15, 1400, -2600, 4000), games(100, 2000, -2000, 4000), 10);
    expect(gap.shows).toBe(false);
  });

  it("needs enough games of each result", () => {
    const draft = [...games(20, 1000, -3000).filter((g) => g.won), ...games(MIN_RESULT_GAMES - 1, 1000, -3000).filter((g) => !g.won)];
    expect(leadGap(draft, games(100, 2000, -2000), 10).shows).toBe(false);
  });

  it("skips games without a lead and drops shared matches from the usual games", () => {
    const draft = games(20, 1000, -3000);
    const noLead = { ...game(true, 0), lead: [] };
    const others = [...games(100, 2000, -2000), ...draft, noLead];
    expect(leadGap(draft, others, 10).gap).toBeCloseTo(-1000);
  });
});

describe("placeboDraft", () => {
  it("draws the draft's wins and losses from the other games, without repeats", () => {
    const draft = games(10, 0, 0);
    const others = games(50, 2000, -2000);
    const fake = placeboDraft(draft, others, seeded(3));
    expect(fake?.filter((g) => g.won)).toHaveLength(10);
    expect(fake?.filter((g) => !g.won)).toHaveLength(10);
    expect(new Set(fake?.map((g) => g.match)).size).toBe(20);
    expect(fake?.every((g) => others.includes(g))).toBe(true);
  });

  it("gives up when there are too few other games", () => {
    expect(placeboDraft(games(10, 0, 0), games(15, 0, 0), seeded(3))).toBeUndefined();
  });
});
