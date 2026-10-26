import { describe, expect, it } from "vitest";
import {
  backtest,
  bracketOf,
  draftAt,
  engineSuggester,
  metaSuggester,
  popularSuggester,
  toMarkdown,
  type Suggester,
} from "../src/backtest/backtest";
import { isEvalMatch, type EvalMatch } from "../src/data/eval-matches";
import { Engine } from "../src/engine/score";
import type { Position } from "../src/engine/types";
import { fixture } from "./fixture";

/** Radiant takes 1-5 and Dire 6-10, alternating Radiant first; positions follow the hero id. */
function game(id: number, radiantWin: boolean, positions = true): EvalMatch {
  const order = [1, 6, 2, 7, 3, 8, 4, 9, 5, 10];
  return {
    id,
    startTime: 1793000000,
    rankTier: 54,
    radiantWin,
    picks: order.map((heroId) => ({
      heroId,
      radiant: heroId <= 5,
      position: positions ? ((((heroId - 1) % 5) + 1) as Position) : null,
    })),
    bans: [42],
  };
}

describe("draftAt", () => {
  it("shows only what the player saw before their pick", () => {
    const input = draftAt(game(1, true), 4)!; // Radiant's third pick, hero 3.
    expect(input.myPosition).toBe(3);
    expect(input.allies).toEqual([
      { heroId: 1, position: 1 },
      { heroId: 2, position: 2 },
    ]);
    expect(input.enemies).toEqual([6, 7]);
    expect(input.bans).toEqual([42]);
    expect(input.rankBracket).toBe(5);
  });

  it("skips picks whose position is unknown, and leaves unknown ally positions to the engine", () => {
    const g = game(1, true);
    g.picks[0]!.position = null;
    expect(draftAt(g, 0)).toBeNull();
    expect(draftAt(g, 2)!.allies).toEqual([{ heroId: 1 }]);
  });

  it("reads the rank bracket from the rank tier", () => {
    expect(bracketOf(54)).toBe(5);
    expect(bracketOf(80)).toBe(8);
    expect(bracketOf(null)).toBeUndefined();
    expect(bracketOf(3)).toBeUndefined();
  });
});

describe("backtest", () => {
  // Always suggests the Radiant heroes in id order, so it "predicts" every Radiant pick.
  const radiantFan: Suggester = () => [1, 2, 3, 4, 5, 11, 12, 13];

  it("counts hits and splits win rates by whether the player took a top 3", () => {
    const r = backtest("fan", radiantFan, [game(1, true), game(2, false)]);
    expect(r.picks).toBe(20);
    expect(r.hitTop8).toBeCloseTo(10 / 20);
    expect(r.hitTop1).toBeCloseTo(2 / 20); // Hero 1 in both games.
    // Heroes 1-3 are in the top 3: 3 picks per game, won once in two games.
    expect(r.top3).toEqual({ picks: 6, winRate: 0.5 });
    expect(r.other.picks).toBe(14);
  });

  it("scores nothing when no position is known", () => {
    const r = backtest("fan", radiantFan, [game(1, true, false)]);
    expect(r).toMatchObject({ picks: 0, hitTop8: 0, top3: { picks: 0, winRate: null } });
  });

  it("writes a table with the lift in points", () => {
    const r = backtest("fan", radiantFan, [game(1, true), game(2, true), game(3, false)]);
    const md = toMarkdown([r], 3);
    expect(md).toContain("Backtest on 3 games, 30 picks with a known position.");
    expect(md).toMatch(/\| fan \| 10\.0% \| 50\.0% \| 66\.7% \(9\) \| 42\.9% \(21\) \| 23\.8 pts \|/);
    expect(toMarkdown([{ ...r, top3: { picks: 0, winRate: null } }], 3)).toContain("| n/a |");
  });
});

describe("suggesters", () => {
  const engine = new Engine(fixture());
  const input = { myPosition: 2 as const, allies: [], enemies: [5], bans: [3] };

  it("never suggest a taken or banned hero", () => {
    for (const suggest of [engineSuggester(engine), popularSuggester(engine), metaSuggester(engine)]) {
      const list = suggest(input);
      expect(list).not.toContain(3);
      expect(list).not.toContain(5);
    }
  });

  it("put the natural mid first for a mid player", () => {
    expect(popularSuggester(engine)(input)[0]).toBe(2);
    expect(metaSuggester(engine)(input)).toEqual([2]);
    expect(engineSuggester(engine)(input)[0]).toBe(2);
  });
});

describe("isEvalMatch", () => {
  it("accepts a saved game and rejects broken ones", () => {
    expect(isEvalMatch(game(1, true))).toBe(true);
    expect(isEvalMatch(null)).toBe(false);
    expect(isEvalMatch({ ...game(1, true), radiantWin: "yes" })).toBe(false);
    expect(isEvalMatch({ ...game(1, true), picks: [{ heroId: 1, radiant: true, position: 9 }] })).toBe(false);
    expect(isEvalMatch({ ...game(1, true), bans: ["x"] })).toBe(false);
  });
});
