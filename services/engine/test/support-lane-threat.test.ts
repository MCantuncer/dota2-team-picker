import { describe, expect, it } from "vitest";
import { guessEnemyPositions, LANE_OPPONENTS } from "../src/engine/positions";
import { Engine } from "../src/engine/score";
import { fixture } from "./fixture";

const engine = new Engine(fixture(), { hardCounters: [] });
const enemies = [4, 5, 6, 7];
const guessed = guessEnemyPositions(enemies.map((e) => engine.fit(e)));

describe("enemy supports in lane", () => {
  it("counts each enemy as at least half its pos 4 plus pos 5 chance in a lane with an enemy support", () => {
    for (const pos of [1, 3, 4, 5] as const) {
      engine.laneChances(enemies, pos).forEach((chance, i) => {
        const fit = guessed[i]!;
        const plain = LANE_OPPONENTS[pos].reduce((s, p) => s + fit[p], 0);
        expect(chance).toBeCloseTo(Math.max(plain, 0.5 * (fit[4] + fit[5])));
      });
    }
  });

  it("raises a support guessed as the other support", () => {
    const chances = engine.laneChances(enemies, 1);
    const raised = guessed.map((fit, i) => chances[i]! - (fit[3] + fit[4]));
    expect(Math.max(...raised)).toBeGreaterThan(0);
  });

  it("leaves a mid's lane alone, since no enemy support plays there", () => {
    engine.laneChances(enemies, 2).forEach((chance, i) => expect(chance).toBeCloseTo(guessed[i]![2]));
  });
});
