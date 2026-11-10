import { describe, expect, it } from "vitest";
import { Engine, personalError, personalScore } from "../src/engine/score";
import type { ScoreBreakdown } from "../src/engine/types";
import { marginOf, verdicts } from "../src/engine/verdict";
import { fixture } from "./fixture";

const NAMES: Record<number, string> = { 10: "Axe", 11: "Lion", 12: "Lina" };
const name = (id: number) => NAMES[id] ?? `Hero ${id}`;
const zero: ScoreBreakdown = { counter: 0, synergy: 0, meta: 0, positionFit: 0, teamNeeds: 0, comfort: 0, flex: 0, pickSafety: 0 };

type Listed = Parameters<typeof verdicts>[0][number];

/** A listed hero whose score is the sum of the parts given. */
function hero(heroId: number, heroName: string, parts: Partial<ScoreBreakdown>, more: Partial<Listed> = {}): Listed {
  const breakdown = { ...zero, ...parts };
  const score = Object.values(breakdown).reduce((s, x) => s + x, 0);
  return { heroId, name: heroName, score, error: 1, breakdown, counterBy: [], synergyBy: [], record: null, ...more };
}

const record = (games: number, wins: number) => ({ games, wins, points: personalScore({ games, wins }), error: personalError({ games, wins }) });

describe("pick verdicts", () => {
  it("calls the leader clear only when it beats every listed hero by the error", () => {
    const leader = hero(1, "Invoker", { meta: 8 });
    const next = hero(2, "Puck", { meta: 3 });
    // A lower hero with a big error (a few games on record) sits inside its own margin to the leader.
    const shaky = { ...hero(3, "Sniper", { meta: 2 }), error: 4 };
    expect(marginOf(leader, next)).toBeCloseTo(1.645 * Math.SQRT2);
    expect(verdicts([leader, next], name, 2)[0]).toMatchObject({ kind: "clear", text: "5.0 points ahead of Puck, more than the 2.3 the data could be off by." });
    expect(verdicts([leader, next, shaky], name, 2)[0]).toMatchObject({ kind: "best", text: "5.0 points ahead of Puck, the next best." });
  });

  it("says why every other hero is behind, with the difference between the two", () => {
    const leader = hero(1, "Invoker", { counter: 3 }, { counterBy: [{ heroId: 10, points: 2.5 }, { heroId: 11, points: 0.5 }] });
    const other = hero(2, "Puck", { counter: -0.5 }, { counterBy: [{ heroId: 10, points: -0.5 }, { heroId: 11, points: 0 }] });
    expect(verdicts([leader, other], name, 2)[1]).toEqual({
      heroId: 2,
      kind: "behind",
      text: "3.5 points behind Invoker: 3.0 worse against Axe.",
      note: null,
    });
    const ally = hero(3, "Lina", {}, { synergyBy: [{ heroId: 11, points: 0 }] });
    const friend = hero(1, "Invoker", { synergy: 1.4 }, { synergyBy: [{ heroId: 11, points: 1.4 }] });
    expect(verdicts([friend, ally], name, 2)[1]!.text).toBe("1.4 points behind Invoker: 1.4 worse with Lion.");
  });

  it("words every score part", () => {
    const lines = (part: keyof ScoreBreakdown) => verdicts([hero(1, "Invoker", { [part]: 2 }), hero(2, "Puck", {})], name, 2)[1]!.text;
    expect(lines("meta")).toBe("2.0 points behind Invoker: lower win rate (-2.0).");
    expect(lines("positionFit")).toBe("2.0 points behind Invoker: played as mid less often (-2.0).");
    expect(lines("teamNeeds")).toBe("2.0 points behind Invoker: adds less of what your team lacks (-2.0).");
    expect(lines("pickSafety")).toBe("2.0 points behind Invoker: easier to punish now (-2.0).");
    expect(lines("flex")).toBe("2.0 points behind Invoker: fits fewer positions, so it shows your plan (-2.0).");
    expect(lines("comfort")).toBe("2.0 points behind Invoker: your record and stars favor Invoker (-2.0).");
  });

  it("says the player wins more on a hero only when the plain win rate agrees", () => {
    const invoker = hero(1, "Invoker", { meta: 6, comfort: 0.6 }, { record: record(83, 41) });
    const puck = hero(2, "Puck", { meta: 2, comfort: 3.5 }, { record: record(38, 24) });
    expect(verdicts([invoker, puck], name, 2)[1]).toMatchObject({
      note: "You win more on Puck (63% of 38 games) than on Invoker (49% of 83). A good pick too.",
      text: "1.1 points behind Invoker: lower win rate (-4.0).",
    });
    // 9-1 shrinks below 140-60, but 90% reads higher than 70%: no note that contradicts the numbers.
    const lucky = hero(3, "Sniper", { meta: 6 }, { record: record(10, 9) });
    const steady = hero(4, "Pudge", { meta: 2 }, { record: record(200, 140) });
    expect(steady.record!.points - lucky.record!.points).toBeGreaterThan(1);
    expect(verdicts([lucky, steady], name, 2)[1]).toMatchObject({ text: "4.0 points behind Sniper: lower win rate (-4.0).", note: null });
  });

  it("names the leader's missing record, and a teammate's list in their name", () => {
    const team = verdicts([hero(1, "Invoker", { comfort: 3 }), hero(2, "Puck", {})], name, 2, "Ali")[1]!.text;
    expect(team).toBe("3.0 points behind Invoker: Ali's record and stars favor Invoker (-3.0).");
    const leader = hero(1, "Invoker", { meta: 8 });
    const puck = hero(2, "Puck", { comfort: 3.5 }, { record: record(38, 24) });
    expect(verdicts([leader, puck], name, 2)[1]).toMatchObject({
      note: "You have won 63% of 38 games on Puck and have no games on Invoker.",
      text: "4.5 points behind Invoker: lower win rate (-8.0).",
    });
    expect(verdicts([leader, puck], name, 2, "Ali")[1]).toMatchObject({
      note: "Ali has won 63% of 38 games on Puck and has no games on Invoker.",
      text: "4.5 points behind Invoker: lower win rate (-8.0).",
    });
  });

  it("reads tied scores as level, and a list of one as the only hero", () => {
    const [first, second] = verdicts([hero(1, "Invoker", { meta: 2 }), hero(2, "Puck", { flex: 2 })], name, 2);
    expect(first!.text).toBe("Level with Puck, the next best.");
    expect(second!.text).toBe("Level with Invoker.");
    expect(verdicts([hero(1, "Invoker", {})], name, 2)).toEqual([{ heroId: 1, kind: "only", text: "The only hero on this list for this draft.", note: null }]);
    expect(verdicts([], name, 2)).toEqual([]);
  });
});

describe("the facts a verdict reads", () => {
  it("splits counters and synergy per hero, and counts the record's error in the score's", () => {
    const engine = new Engine(fixture());
    const input = { myPosition: 2 as const, allies: [{ heroId: 1 }], enemies: [5, 6], count: 40 };
    const plain = engine.suggest(input);
    const withRecord = engine.suggest({ ...input, personal: { 3: { games: 20, wins: 14 } } });
    for (const s of plain) {
      expect(s.counterBy.reduce((t, x) => t + x.points, 0)).toBeCloseTo(s.breakdown.counter, 1);
      expect(s.synergyBy.reduce((t, x) => t + x.points, 0)).toBeCloseTo(s.breakdown.synergy, 1);
      expect(s.record).toBeNull();
    }
    const before = plain.find((s) => s.heroId === 3)!;
    const after = withRecord.find((s) => s.heroId === 3)!;
    expect(after.record).toMatchObject({ games: 20, wins: 14 });
    expect(after.record!.error).toBeCloseTo(personalError({ games: 20, wins: 14 }), 2);
    expect(after.error).toBeCloseTo(Math.hypot(before.error, after.record!.error), 1);
    // A 10-0 record still has an error, since its shrunk rate is not 100%.
    expect(personalError({ games: 10, wins: 10 })).toBeGreaterThan(1);
  });
});
