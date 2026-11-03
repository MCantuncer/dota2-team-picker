import { describe, expect, it } from "vitest";
import { namedPoints, ordinal, pickLines, points, summaryOf, type Line } from "../src/engine/reasons";
import { Engine } from "../src/engine/score";
import type { ScoreBreakdown } from "../src/engine/types";
import { fixture } from "./fixture";

describe("reason helpers", () => {
  it("formats points and places", () => {
    expect(points(3.14)).toBe("+3.1");
    expect(points(-2.36)).toBe("-2.4");
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd"]);
  });

  it("names the two biggest heroes with their points", () => {
    const text = namedPoints([
      { name: "Lion", value: 0.6 },
      { name: "Axe", value: 3.1, note: "likely your lane" },
      { name: "Viper", value: 1.2 },
    ]);
    expect(text).toBe("Axe (+3.1, likely your lane) and Viper (+1.2)");
  });

  it("puts draft lines first, keeps one base line, and ends with one warning", () => {
    const line = (text: string, value: number, kind: Line["kind"]): Line => ({ text, value, kind });
    const lines = [line("meta", 4, "base"), line("flex", 1, "base"), line("counter", 2, "draft"), line("synergy", 3, "draft")];
    const warnings = [
      { text: "Small risk", value: 0.6 },
      { text: "Loses to Axe", value: 2 },
    ];
    expect(pickLines(lines, warnings)).toEqual(["synergy", "counter", "meta", "Watch out: loses to Axe"]);
  });

  it("shows only base lines while the draft gives none", () => {
    const lines: Line[] = [
      { text: "meta", value: 4, kind: "base" },
      { text: "flex", value: 1, kind: "base" },
    ];
    expect(pickLines(lines, [])).toEqual(["meta", "flex"]);
  });

  it("caps a card at four lines and a warning", () => {
    const lines: Line[] = [1, 2, 3, 4, 5].map((v) => ({ text: `d${v}`, value: v, kind: "draft" }));
    expect(pickLines(lines, [{ text: "X", value: 1 }])).toEqual(["d5", "d4", "d3", "d2", "Watch out: x"]);
  });

  it("splits the score into this draft and the rest", () => {
    const b: ScoreBreakdown = { counter: 2, synergy: 1, meta: 1.5, positionFit: 0.5, teamNeeds: 1, comfort: 1.5, flex: 0, pickSafety: -0.5 };
    expect(summaryOf(b)).toBe("Score +7.0: +3.5 from this draft, +3.5 from meta, role and comfort");
  });
});

describe("suggestion cards", () => {
  const engine = new Engine(fixture(), { hardCounters: [] });

  it("gives every card a summary and a number on each draft line", () => {
    const cards = engine.suggest({ myPosition: 2, allies: [{ heroId: 6, position: 5 }], enemies: [5], favorites: [2] });
    for (const card of cards) {
      expect(card.summary).toMatch(/^Score [+-]\d+\.\d, \d+(st|nd|rd|th) of \d+ mids here: [+-]\d+\.\d from this draft, [+-]\d+\.\d from meta, role and comfort$/);
      expect(card.reasons.length).toBeLessThanOrEqual(6);
      for (const reason of card.reasons) expect(reason).toMatch(/[+-]\d+\.\d|\d+\.\d%/);
    }
  });

  it("names the enemy it beats with its points", () => {
    const [first] = engine.suggest({ myPosition: 2, allies: [], enemies: [5] });
    expect(first!.reasons[0]).toMatch(/^Beats Offlane Five \(\+\d+\.\d/);
  });

  it("keeps favorites out of the reasons and in the tags", () => {
    const card = engine.suggest({ myPosition: 2, allies: [], enemies: [], favorites: [2] }).find((s) => s.heroId === 2)!;
    expect(card.tags).toEqual(["Favorite (+1.5)"]);
    expect(card.reasons.join()).not.toMatch(/favorite/i);
  });
});
