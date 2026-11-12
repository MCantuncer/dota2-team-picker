import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Engine, HAND_WEIGHTS } from "../src/engine/score";
import type { DraftInput, GamesWins, Snapshot } from "../src/engine/types";

const golden = JSON.parse(readFileSync(new URL("./fixtures/golden-snapshot.json", import.meta.url), "utf8")) as Snapshot;

/** The golden snapshot with Divine and Immortal games: a third of every all-ranks record, a little better for the lower id. */
function withRanks(): Snapshot {
  const third = (rows: Record<string, GamesWins>, lift: (k: string) => number) =>
    Object.fromEntries(
      Object.entries(rows).map(([k, r]) => [k, { games: r.games / 3, wins: Math.min(r.games / 3, r.wins / 3 + lift(k)) }]),
    );
  const matchups = Object.fromEntries(Object.entries(golden.matchups).map(([a, row]) => [a, third(row, (b) => (Number(a) < Number(b) ? 4 : 0))]));
  return { ...golden, rankMatchups: { 4: matchups }, rankSynergy: { 4: third(golden.synergy, () => 2) } };
}

const ids = Object.keys(golden.heroes).map(Number).slice(0, 25);
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

describe("pair facts", () => {
  for (const [name, data] of [
    ["all ranks", golden],
    ["with rank games", withRanks()],
  ] as const) {
    it(`give the same edge the score uses (${name})`, () => {
      const engine = new Engine(data);
      for (const bracket of [undefined, 3, 8] as const) {
        for (const a of ids) {
          for (const b of ids) {
            if (a === b) continue;
            expect(engine.pairFacts(a, b, -1, bracket).edge).toBeCloseTo(engine.matchupEdge(a, b, bracket), 9);
            expect(engine.pairFacts(a, b, 1, bracket).edge).toBeCloseTo(engine.synergyEdge(a, b, bracket), 9);
          }
        }
      }
    });
  }

  it("show the rank group's games, with all ranks as the backup", () => {
    const engine = new Engine(withRanks());
    const [a, b] = Object.entries(golden.matchups).flatMap(([x, row]) => Object.keys(row).map((y) => [Number(x), Number(y)]))[0]!;
    const facts = engine.pairFacts(a!, b!, -1, 7);
    expect(facts.group).toBe(4);
    expect(facts.allRanks).toEqual(golden.matchups[a!]![b!]);
    expect(facts.seen!.games).toBeCloseTo(golden.matchups[a!]![b!]!.games / 3, 6);
    expect(engine.pairFacts(a!, b!, -1).group).toBe(0);
    expect(engine.pairFacts(a!, b!, -1).allRanks).toBeNull();
  });
});

describe("Why details on a suggestion", () => {
  const input: DraftInput = {
    myPosition: 1,
    allies: [
      { heroId: ids[3]!, position: 5 },
      { heroId: ids[4]!, position: 2 },
    ],
    enemies: [ids[5]!, ids[6]!, ids[7]!],
    bans: [ids[8]!, ids[9]!],
    rankBracket: 7,
    favorites: ids.slice(10, 20),
    top: ids.slice(10, 12),
    personal: { [ids[10]!]: { games: 31, wins: 19 }, [ids[11]!]: { games: 4, wins: 1 } },
    count: 100,
  };

  for (const [name, weights] of [
    ["hand weights", null],
    ["learned weights", { ...HAND_WEIGHTS, counter: 0.8, synergy: 1.3, comfort: 0.7, pickSafety: 1.2, teamNeeds: 0.9, positionFit: 1.1 }],
  ] as const) {
    it(`adds up to each score part (${name})`, () => {
      const engine = new Engine(withRanks(), { scoreWeights: weights });
      const list = engine.suggest(input);
      expect(list.length).toBeGreaterThan(20);
      for (const s of list) {
        const why = s.why!;
        const b = s.breakdown;
        expect(sum(why.counters.map((c) => c.points))).toBeCloseTo(b.counter, 1);
        expect(sum(why.synergy.map((c) => c.points))).toBeCloseTo(b.synergy, 1);
        expect(why.comfort.favorite + why.comfort.top + (why.comfort.record?.points ?? 0)).toBeCloseTo(b.comfort, 1);
        const covered = why.teamNeeds.needs.filter((n) => n.isCovered).length;
        expect(covered * why.teamNeeds.each).toBeCloseTo(b.teamNeeds, 1);
        const safety = why.pickSafety;
        expect(safety.risk + (safety.phase ?? 0) + sum(safety.gambles.map((g) => g.points))).toBeCloseTo(b.pickSafety, 1);
        expect(why.meta.points).toBe(b.meta);
        expect(why.roleFit.points).toBe(b.positionFit);
        expect(why.flex.points).toBe(b.flex);
        // Each pair's points are its edge times its weight times the part's weight, unless a hard counter sets them.
        for (const c of why.counters) {
          if (c.hardGap !== null) expect(c.points).toBeCloseTo(-c.hardGap * engine.partWeights.counter, 1);
          else expect(c.points).toBeCloseTo(c.edge * c.weight * engine.partWeights.counter, 1);
          expect(c.weight).toBeCloseTo(1 + 0.5 * c.laneChance, 9);
        }
        for (const c of why.synergy) expect(c.points).toBeCloseTo(c.edge * c.weight * engine.partWeights.synergy, 1);
      }
    });
  }

  it("marks the lane partner, who counts 1.5 times", () => {
    const list = new Engine(golden).suggest(input);
    for (const s of list) {
      const [partner, other] = s.why!.synergy;
      expect(partner!.isPartner).toBe(true);
      expect(partner!.weight).toBe(1.5);
      expect(other!.isPartner).toBe(false);
      expect(other!.weight).toBe(1);
    }
  });

  it("gives role fit the shares that bound its points", () => {
    const s = new Engine(golden).suggest(input)[0]!;
    const fit = s.why!.roleFit;
    expect([fit.zeroAt, fit.fullAt, fit.maxPoints]).toEqual([0.3, 0.6, 3]);
    expect(fit.points).toBeCloseTo(10 * (Math.min(fit.share, 0.6) - 0.3), 1);
  });

  it("keeps the player's record with the rate it counts", () => {
    const s = new Engine(golden).suggest(input).find((x) => x.heroId === ids[10])!;
    const record = s.why!.comfort.record!;
    expect(record.games).toBe(31);
    expect(record.counted).toBeCloseTo((19 + 7.5) / 46, 9);
    expect(s.why!.comfort.favorite).toBe(1.5);
    expect(s.why!.comfort.top).toBe(0.5);
  });

  it("is on every returned hero and only those", () => {
    const list = new Engine(golden).suggest({ ...input, count: 8 });
    expect(list).toHaveLength(8);
    expect(list.every((s) => s.why)).toBe(true);
  });
});
