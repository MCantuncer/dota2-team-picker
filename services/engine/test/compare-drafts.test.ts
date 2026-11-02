import { describe, expect, it } from "vitest";
import { runDrafts, toInput, toMarkdown, type NamedDraft } from "../src/backtest/compare-drafts";
import { Engine } from "../src/engine/score";
import { fixture } from "./fixture";

const drafts: NamedDraft[] = [
  { label: "Mid, empty", myPosition: 2 },
  { label: "Mid vs Offlane Five", myPosition: 2, allies: ["Support Four:5"], enemies: ["Offlane Five"], bans: ["Carry One"] },
];

describe("compare-drafts", () => {
  it("turns hero names into a draft, ignoring case and punctuation", () => {
    const input = toInput(new Engine(fixture()), drafts[1]!);
    expect(input.allies).toEqual([{ heroId: 4, position: 5 }]);
    expect(input.enemies).toEqual([5]);
    expect(input.bans).toEqual([1]);
    expect(toInput(new Engine(fixture()), { label: "x", myPosition: 2, enemies: ["offlane-five"] }).enemies).toEqual([5]);
  });

  it("refuses a hero the snapshot does not have", () => {
    expect(() => toInput(new Engine(fixture()), { label: "x", myPosition: 2, enemies: ["Nobody"] })).toThrow(/Nobody/);
  });

  it("shows the old list beside the new one and counts the changed heroes", () => {
    const after = runDrafts(new Engine(fixture()), drafts);
    const before = after.map((run) => ({ ...run, cards: run.cards.map((c, i) => (i === 0 ? { ...c, name: "Old Hero" } : c)) }));
    const md = toMarkdown(after, before, drafts);
    expect(md).toContain("### Mid vs Offlane Five");
    expect(md).toContain("1 of 2 heroes changed.");
    expect(md).toContain("| # | Before | After |");
    expect(md).toContain("**Old Hero**");
  });
});
