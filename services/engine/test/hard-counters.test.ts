import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HARD_COUNTERS } from "../src/engine/hard-counters";
import { Engine } from "../src/engine/score";
import type { Snapshot } from "../src/engine/types";
import { fixture } from "./fixture";

// Mid Three (3) is hard countered by Support Six (6).
const engine = new Engine(fixture(), { hardCounters: [{ hero: 3, counter: 6, gap: 8, names: "Mid Three < Support Six" }] });
const find = (list: ReturnType<Engine["suggest"]>, id: number) => list.find((s) => s.heroId === id)!;

describe("hard counter list", () => {
  it("names real heroes in the published data", () => {
    const data = JSON.parse(readFileSync("data/snapshot.json", "utf8")) as Snapshot;
    for (const hc of HARD_COUNTERS) {
      const [hero, counter] = hc.names.split(" < ");
      expect(data.heroes[hc.hero]?.name).toBe(hero);
      expect(data.heroes[hc.counter]?.name).toBe(counter);
      expect(hc.gap).toBeGreaterThan(0);
    }
  });
});

describe("hard counters in the score", () => {
  const notes = (s: { hardCounters: { status: string; text: string }[] }) => s.hardCounters.map((n) => `${n.status}: ${n.text}`);

  it("costs at least the gap when the counter is on the enemy team", () => {
    const withCounter = find(engine.suggest({ myPosition: 2, allies: [], enemies: [6] }), 3);
    const plain = find(new Engine(fixture(), { hardCounters: [] }).suggest({ myPosition: 2, allies: [], enemies: [6] }), 3);
    expect(withCounter.breakdown.counter).toBeLessThanOrEqual(-8);
    expect(plain.breakdown.counter).toBeGreaterThan(-1);
    expect(notes(withCounter)).toEqual(["enemy: Hard countered: Support Six is on the enemy team"]);
  });

  it("does not add the list gap on top of a matchup the data already shows", () => {
    expect(engine.counterEdges(3, [6], [0])[0]!.edge).toBe(-8);
  });

  it("calls an open counter a gamble and lowers pick safety", () => {
    const risky = find(engine.suggest({ myPosition: 2, allies: [], enemies: [] }), 3);
    const plain = find(new Engine(fixture(), { hardCounters: [] }).suggest({ myPosition: 2, allies: [], enemies: [] }), 3);
    expect(notes(risky)).toEqual(["open: Gamble: Support Six still available"]);
    expect(risky.breakdown.pickSafety).toBeLessThan(plain.breakdown.pickSafety - 7);
    expect(plain.hardCounters).toEqual([]);
  });

  it("calls the hero safe, at no cost, once the counter is banned or on your team", () => {
    const plain = find(new Engine(fixture(), { hardCounters: [] }).suggest({ myPosition: 2, allies: [], enemies: [], bans: [6] }), 3);
    for (const input of [
      { myPosition: 2 as const, allies: [], enemies: [], bans: [6] },
      { myPosition: 2 as const, allies: [{ heroId: 6 }], enemies: [] },
    ]) {
      const hero = find(engine.suggest(input), 3);
      expect(notes(hero)).toEqual(["out: Support Six is out, safe to pick"]);
    }
    expect(find(engine.suggest({ myPosition: 2, allies: [], enemies: [], bans: [6] }), 3).score).toBe(plain.score);
  });

  it("drops an open counter once the enemy team is full", () => {
    expect(engine.hardCounterNotes(3, { allies: [], enemies: [1, 2, 4, 5, 7] })).toEqual([]);
  });
});
