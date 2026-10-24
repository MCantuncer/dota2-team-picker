import { describe, expect, it } from "vitest";
import { guessEnemyPositions, positionFit } from "../src/engine/positions";
import { Engine } from "../src/engine/score";
import { unmetNeeds } from "../src/engine/traits";
import { POSITIONS } from "../src/engine/types";
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
    expect(first!.reasons[0]).toMatch(/Strong against Offlane Five/);
  });

  it("gives favorites a boost and says why", () => {
    const engine = new Engine(fixture());
    const [first] = engine.suggest({ myPosition: 2, allies: [], enemies: [], favorites: [2] });
    expect(first!.name).toBe("Mid Two");
    expect(first!.reasons).toContain("One of your favorite heroes");
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
