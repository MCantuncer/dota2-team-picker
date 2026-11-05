import { describe, expect, it } from "vitest";
import { laneOdds, pairLane, pairText } from "../src/engine/lane-odds";
import type { Snapshot } from "../src/engine/types";
import { fixture } from "./fixture";

function data(): Snapshot {
  const d = fixture();
  d.laneOutcomes = {
    // All ranks: hero 1 beats 2 in lane, loses to 3.
    "0": { 1: { 2: [1000, 500, 200, 300], 3: [1000, 300, 200, 500] } },
    // Legend and Ancient (rank group 3): hero 1 against 2 is even.
    "3": { 1: { 2: [800, 300, 200, 300] } },
  };
  return d;
}

describe("pairLane", () => {
  it("uses the rank group when it has the pair, all ranks otherwise", () => {
    expect(pairLane(data(), 1, 2)).toEqual({ hero: 1, enemy: 2, games: 1000, won: 500, drawn: 200, lost: 300 });
    expect(pairLane(data(), 1, 2, 5)?.games).toBe(800);
    expect(pairLane(data(), 1, 3, 5)?.games).toBe(1000);
    expect(pairLane(data(), 2, 1)).toBeUndefined();
  });
});

describe("laneOdds", () => {
  it("weighs each enemy by the chance it is in the lane", () => {
    const sureTwo = laneOdds(data(), [1], [{ id: 2, odds: { 3: 0.9 } }, { id: 3, odds: { 3: 0.1 } }], [3, 4]);
    expect(sureTwo?.verdict).toBe("win");
    expect(sureTwo?.net).toBeCloseTo(0.9 * 0.2 - 0.1 * 0.2);
    expect(sureTwo?.key.enemy).toBe(2);
    const sureThree = laneOdds(data(), [1], [{ id: 2, odds: { 3: 0.1 } }, { id: 3, odds: { 4: 0.9 } }], [3, 4]);
    expect(sureThree?.verdict).toBe("hard");
    expect(sureThree?.key.enemy).toBe(3);
  });

  it("calls a small net even and uses the rank group", () => {
    expect(laneOdds(data(), [1], [{ id: 2, odds: { 3: 1 } }], [3, 4], 5)?.verdict).toBe("even");
  });

  it("is undefined without lane data or with enemies outside the lane", () => {
    expect(laneOdds(data(), [4], [{ id: 2, odds: { 3: 1 } }], [3, 4])).toBeUndefined();
    expect(laneOdds(data(), [1], [{ id: 2, odds: { 1: 1 } }], [3, 4])).toBeUndefined();
    const none = fixture();
    expect(laneOdds(none, [1], [{ id: 2, odds: { 3: 1 } }], [3, 4])).toBeUndefined();
  });
});

describe("pairText", () => {
  it("gives the shares and the games", () => {
    expect(pairText({ hero: 1, enemy: 3, games: 8120, won: 2517, drawn: 3086, lost: 2517 }, (id) => `H${id}`)).toBe(
      "H1 wins 31% and loses 31% of 8,120 lanes against H3.",
    );
  });
});
