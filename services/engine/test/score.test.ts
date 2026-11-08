import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { guessEnemyPositions, positionFit } from "../src/engine/positions";
import { Engine } from "../src/engine/score";
import { unmetNeeds } from "../src/engine/traits";
import { POSITIONS, type Snapshot } from "../src/engine/types";
import { fixture } from "./fixture";

describe("Engine.suggest", () => {
  it("only suggests free heroes that fit the position", () => {
    const engine = new Engine(fixture());
    const result = engine.suggest({ myPosition: 2, allies: [{ heroId: 2 }], enemies: [1] });
    const ids = result.map((s) => s.heroId);
    expect(ids).not.toContain(1);
    expect(ids).not.toContain(2);
    expect(ids[0]).toBe(3);
    expect(ids).not.toContain(6); // Support Six never goes mid.
  });

  it("prefers the hero that counters the enemy", () => {
    const engine = new Engine(fixture());
    const [first, second] = engine.suggest({ myPosition: 2, allies: [], enemies: [5] });
    expect(first!.name).toBe("Mid Three");
    expect(second!.name).toBe("Mid Two");
    expect(first!.breakdown.counter).toBeGreaterThan(5);
    expect(first!.reasons[0]).toMatch(/^Beats Offlane Five \(\+\d+\.\d\)/);
  });

  it("gives favorites a boost and says why", () => {
    const engine = new Engine(fixture());
    const [first] = engine.suggest({ myPosition: 2, allies: [], enemies: [], favorites: [2] });
    expect(first!.name).toBe("Mid Two");
    expect(first!.tags).toContain("Favorite (+1.5)");
  });

  describe("Top 5", () => {
    const engine = new Engine(fixture());
    const card = (input: Partial<Parameters<Engine["suggest"]>[0]>, id = 2) =>
      engine.suggest({ myPosition: 2, allies: [], enemies: [], count: 20, ...input }).find((s) => s.heroId === id)!;

    it("adds a small push on top of the favorite boost and says why", () => {
      const fav = card({ favorites: [2] });
      const top = card({ favorites: [2], top: [2] });
      expect(top.breakdown.comfort - fav.breakdown.comfort).toBeCloseTo(0.5);
      expect(top.score - fav.score).toBeCloseTo(0.5);
      expect(top.tags).toEqual(["Favorite (+1.5)", "Top 5 (+0.5)"]);
    });

    it("changes nothing without a Top 5", () => {
      const before = engine.suggest({ myPosition: 2, allies: [], enemies: [5], favorites: [2] });
      expect(engine.suggest({ myPosition: 2, allies: [], enemies: [5], favorites: [2], top: [] })).toEqual(before);
    });

    it("never lifts a hero outside the pool", () => {
      expect(card({ top: [2] })).toEqual(card({}));
      expect(card({ favorites: [3], top: [2] })).toEqual(card({ favorites: [3] }));
    });

    it("loses to a favorite with a clear counter edge", () => {
      const [first] = engine.suggest({ myPosition: 2, allies: [], enemies: [5], favorites: [2, 3], top: [2] });
      expect(first!.name).toBe("Mid Three");
    });
  });

  it("respects bans and the count", () => {
    const engine = new Engine(fixture());
    expect(engine.suggest({ myPosition: 5, allies: [], enemies: [], count: 1 })).toHaveLength(1);
    const result = engine.suggest({ myPosition: 5, allies: [], enemies: [], bans: [6] });
    expect(result.map((s) => s.heroId)).toEqual([4]);
  });
});

describe("positions", () => {
  it("splits the safe lane between carry and support", () => {
    const data = fixture();
    expect(positionFit(data.heroes[1]!, data.laneRoles[1])[1]).toBeGreaterThan(0.8);
    expect(positionFit(data.heroes[6]!, data.laneRoles[6])[5]).toBeGreaterThan(0.8);
  });

  it("never puts two enemies in the same position", () => {
    const data = fixture();
    const fits = [2, 3].map((id) => positionFit(data.heroes[id]!, data.laneRoles[id]));
    const [a, b] = guessEnemyPositions(fits);
    for (const m of [a!, b!]) expect(POSITIONS.reduce((s, p) => s + m[p], 0)).toBeCloseTo(1);
    // Both are mids, so each is mid about half the time.
    expect(a![2]).toBeCloseTo(0.5, 1);
  });
});

describe("team needs", () => {
  it("lists what the team is missing", () => {
    const data = fixture();
    const needs = unmetNeeds([data.heroes[5]!]);
    expect(needs).not.toContain("initiation");
    expect(needs).toContain("save");
  });
});


describe("rank group matchups", () => {
  it("uses the all-ranks edge when the rank group has no games", () => {
    const engine = new Engine(fixture());
    expect(engine.matchupEdge(3, 5, 6)).toBeCloseTo(engine.matchupEdge(3, 5));
  });

  it("moves the edge toward what the rank group's games show", () => {
    const data = fixture();
    // At Legend-Ancient, hero 5 beats hero 3 in 400 of 500 games.
    data.rankMatchups = { 3: { 3: { 5: { games: 500, wins: 100 } }, 5: { 3: { games: 500, wins: 400 } } } };
    const engine = new Engine(data);
    expect(engine.matchupEdge(3, 5, 5)).toBeLessThan(engine.matchupEdge(3, 5) - 10);
    expect(engine.matchupEdge(3, 5, 1)).toBeCloseTo(engine.matchupEdge(3, 5));
  });
});

describe("pick phase", () => {
  /** Mid Three wins 40% as an early pick and 60% as a late one; every other hero is even. */
  const withPickPhase = (games: number) => {
    const data = fixture();
    data.pickPhase = {};
    for (const id of Object.keys(data.heroes)) data.pickPhase[id] = { games: [games, 0, games], wins: [games / 2, 0, games / 2] };
    data.pickPhase[3] = { games: [games, 0, games], wins: [games * 0.4, 0, games * 0.6] };
    return data;
  };

  it("scores a hero by how it does when picked at this point of the draft", () => {
    const engine = new Engine(withPickPhase(10000));
    const early = engine.suggest({ myPosition: 2, allies: [], enemies: [] }).find((s) => s.heroId === 3)!;
    const late = engine
      .suggest({ myPosition: 2, allies: [{ heroId: 1 }, { heroId: 4 }, { heroId: 5 }, { heroId: 6 }], enemies: [] })
      .find((s) => s.heroId === 3)!;
    expect(early.breakdown.pickSafety).toBeLessThan(-5);
    expect(early.reasons.join()).not.toMatch(/Wins more as a last-round pick/);
    expect(late.breakdown.pickSafety).toBeGreaterThan(5);
    expect(late.reasons.join()).toMatch(/Wins more as a last-round pick \(\+\d+\.\d\)/);
    expect(engine.pickPhaseEdge(2, 0)).toBeCloseTo(0);
  });

  it("keeps the matchup-based pick safety while the counts are too small", () => {
    const engine = new Engine(withPickPhase(10));
    expect(engine.pickPhaseEdge(3, 0)).toBeUndefined();
    const plain = new Engine(fixture()).suggest({ myPosition: 2, allies: [], enemies: [] });
    expect(engine.suggest({ myPosition: 2, allies: [], enemies: [] })).toEqual(plain);
  });
});

describe("Engine.matchupEdge on real data", () => {
  // The repo copy of the hero data: every hero has a full matchup row.
  const engine = new Engine(JSON.parse(readFileSync(new URL("../data/snapshot.json", import.meta.url), "utf8")) as Snapshot);

  it("gives no hero an edge against the field as a whole", () => {
    // Weighted by games, a hero's results against everyone add up to its own win rate, which the
    // expected value already holds, so its edges should average out to about 0. Shrinking small
    // samples leaves a little; a bias against every enemy leaves a lot (up to 1.1 before the fix).
    const means = engine.heroes.map((hero) => {
      let games = 0;
      let edge = 0;
      for (const enemy of engine.heroes) {
        const n = engine.data.matchups[hero.id]?.[enemy.id]?.games ?? 0;
        if (enemy.id === hero.id || n === 0) continue;
        games += n;
        edge += n * engine.matchupEdge(hero.id, enemy.id);
      }
      return { name: hero.name, edge: edge / games };
    });
    for (const m of means) expect(Math.abs(m.edge), m.name).toBeLessThan(0.4);
    const sd = Math.sqrt(means.reduce((s, m) => s + m.edge ** 2, 0) / means.length);
    expect(sd).toBeLessThan(0.2);
});
});

describe("score error margins", () => {
  const engine = new Engine(fixture());

  it("shrinks the error as the games behind a number grow", () => {
    // 1000 games plus 250 prior games: 50 / sqrt(1250).
    expect(engine.matchupError(3, 5)).toBeCloseTo(50 / Math.sqrt(1250), 6);
    // No games at all: only the prior's 250.
    expect(engine.matchupError(3, 4)).toBeCloseTo(50 / Math.sqrt(250), 6);
    expect(engine.matchupError(3, 5)).toBeLessThan(engine.matchupError(3, 4));
    expect(engine.synergyError(3, 4)).toBe(engine.synergyError(4, 3));
    // One bracket has 1000 games; all eight together have 8000.
    expect(engine.winRateError(3, 2)).toBeCloseTo(50 / Math.sqrt(1300), 6);
    expect(engine.winRateError(3)).toBeCloseTo(50 / Math.sqrt(8300), 6);
  });

  it("gives each suggestion an error that grows with the heroes it is scored against", () => {
    const card = (enemies: number[], allies: number[] = []) =>
      engine
        .suggest({ myPosition: 2, allies: allies.map((heroId) => ({ heroId })), enemies, count: 20 })
        .find((s) => s.heroId === 3)!;
    const alone = card([]);
    expect(alone.error).toBeGreaterThan(0);
    expect(card([5]).error).toBeGreaterThan(alone.error);
    expect(card([5, 7]).error).toBeGreaterThan(card([5]).error);
    expect(card([], [4]).error).toBeGreaterThan(alone.error);
  });
});
