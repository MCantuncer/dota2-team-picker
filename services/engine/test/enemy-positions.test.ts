import { describe, expect, it } from "vitest";
import { guessEnemyPositions, positionFit } from "../src/engine/positions";
import { openSlots } from "../src/engine/risk";
import { Engine } from "../src/engine/score";
import { fixture } from "./fixture";

const data = fixture();
const fit = (id: number) => positionFit(data.heroes[id]!, data.laneRoles[id]);

describe("enemy positions set by hand", () => {
  it("puts a known enemy only in its position and the others around it", () => {
    // Both are mids: guessed, each is mid half the time. Set Mid Three to mid and Mid Two moves out.
    const [two, three] = guessEnemyPositions([fit(2), fit(3)], [undefined, 2]);
    expect(three![2]).toBe(1);
    expect(two![2]).toBe(0);
  });

  it("keeps a known position even when it is unusual for the hero", () => {
    const [carry] = guessEnemyPositions([fit(1)], [5]);
    expect(carry![5]).toBe(1);
  });

  it("falls back to each hero's own fit when two enemies are set to the same position", () => {
    const [two, three, offlane] = guessEnemyPositions([fit(2), fit(3), fit(5)], [2, 2, undefined]);
    expect(two![2]).toBe(1);
    expect(three![2]).toBe(1);
    expect(offlane).toEqual(fit(5));
  });

  it("changes who you face in lane", () => {
    const engine = new Engine(fixture(), { hardCounters: [] });
    // Offlane Five set to mid is your lane opponent when you play mid.
    expect(engine.laneChances([2, 5], 2)[1]).toBeLessThan(0.1);
    expect(engine.laneChances([2, 5], 2, { 5: 2 })[1]).toBe(1);
  });

  it("counts a lane counter more once the enemy's position is set", () => {
    const engine = new Engine(fixture(), { hardCounters: [] });
    // Mid Three beats Offlane Five; in lane it counts extra.
    const counter = (enemyPositions?: Record<number, 2>) =>
      engine.suggest({ myPosition: 2, allies: [], enemies: [5], enemyPositions, count: 10 }).find((s) => s.heroId === 3)!.breakdown.counter;
    expect(counter({ 5: 2 })).toBeGreaterThan(counter());
  });

  it("closes a known enemy's position for their next picks", () => {
    const engine = new Engine(fixture(), { hardCounters: [] });
    const pool = [1, 2, 3, 5, 6, 7];
    // Support Four is a 4 or a 5 by its lane; set to 5, only pos 4 is still to come among the supports.
    const open = (known?: Record<number, 4 | 5>) => new Map(openSlots(engine, pool, [4], known).map((s) => [s.position, s.open]));
    expect(open({ 4: 5 }).get(5)).toBeUndefined();
    expect(open({ 4: 5 }).get(4)).toBe(1);
    expect(open().get(5)).toBeLessThan(1);
  });
});
