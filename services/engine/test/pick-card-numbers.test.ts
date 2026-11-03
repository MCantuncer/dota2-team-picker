import { describe, expect, it } from "vitest";
import { pickLines, summaryOf } from "../src/engine/reasons";
import { Engine } from "../src/engine/score";
import type { ScoreBreakdown } from "../src/engine/types";
import { fixture } from "./fixture";

describe("losing matchups on the card", () => {
  it("shows a lost matchup even when a bigger warning is there", () => {
    const warnings = [
      { text: "Low win rate right now: 47.6%", value: 2.4 },
      { text: "Loses to Axe (-1.4, likely your lane)", value: 1.4, matchup: true },
    ];
    expect(pickLines([], warnings)).toEqual([
      "Watch out: loses to Axe (-1.4, likely your lane)",
      "Watch out: low win rate right now: 47.6%",
    ]);
  });

  it("keeps the usual single warning when the matchup loss is small", () => {
    const warnings = [
      { text: "Low win rate right now: 47.6%", value: 2.4 },
      { text: "Loses to Axe (-0.6)", value: 0.6, matchup: true },
    ];
    expect(pickLines([], warnings)).toEqual(["Watch out: low win rate right now: 47.6%"]);
  });
});

describe("place among the heroes for the position", () => {
  const b: ScoreBreakdown = { counter: -3.2, synergy: -1.6, meta: -2.4, positionFit: 3, teamNeeds: 0, comfort: 1.5, flex: 0, pickSafety: -0.7 };

  it("says where the score puts the hero", () => {
    expect(summaryOf(b, { rank: 31, of: 47, pos: 1 })).toBe(
      "Score -3.4, 31st of 47 carries here: -5.5 from this draft, +2.1 from meta, role and comfort",
    );
  });

  it("ranks every scored hero before the list is cut, with the score on the card", () => {
    const engine = new Engine(fixture(), { hardCounters: [] });
    const input = { myPosition: 2 as const, allies: [], enemies: [5], favorites: [2] };
    const all = engine.suggest({ ...input, count: 100 });
    const top = engine.suggest({ ...input, count: 1 });
    expect(top[0]!.place).toEqual({ rank: 1, of: all.length });
    all.forEach((s, i) => expect(s.place).toEqual({ rank: i + 1, of: all.length }));
    for (let i = 1; i < all.length; i++) expect(all[i - 1]!.score).toBeGreaterThanOrEqual(all[i]!.score);
  });
});

describe("thin matchups", () => {
  it("says how few games a named matchup has", () => {
    const data = fixture();
    data.matchups[3]![5] = { games: 60, wins: 40 };
    data.matchups[5]![3] = { games: 60, wins: 20 };
    const engine = new Engine(data, { hardCounters: [] });
    const card = engine.suggest({ myPosition: 2, allies: [], enemies: [5], count: 100 }).find((s) => s.heroId === 3)!;
    expect(card.reasons[0]).toMatch(/^Beats Offlane Five \(\+\d+\.\d, (likely your lane, )?only 60 games\)/);
  });

  it("leaves the note off a matchup with enough games", () => {
    const engine = new Engine(fixture(), { hardCounters: [] });
    const card = engine.suggest({ myPosition: 2, allies: [], enemies: [5], count: 100 }).find((s) => s.heroId === 3)!;
    expect(card.reasons[0]).not.toMatch(/games\)/);
  });
});
