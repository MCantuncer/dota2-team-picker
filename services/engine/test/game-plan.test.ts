import { describe, expect, it } from "vitest";
import { gamePlan } from "../src/engine/game-plan";
import { Engine } from "../src/engine/score";
import type { HeroInfo, Snapshot } from "../src/engine/types";

const hero = (id: number, name: string, roles: string[]): HeroInfo => ({ id, name, roles, attackType: "Melee", primaryAttr: "str" });

/**
 * Ours: Medusa 1, Magnus 2, Sven 3, Lion 4, Crystal Maiden 5 (Magnus + Sven is a known combo).
 * Theirs: Anti-Mage (hard counters Medusa), Spectre, Terrorblade (late game), Witch Doctor, Lich.
 * Each hero's lane data puts it in one position, so the enemy guess is fixed.
 */
function data(): Snapshot {
  const heroes: [HeroInfo, "1" | "2" | "3"][] = [
    [hero(94, "Medusa", ["Carry"]), "1"],
    [hero(97, "Magnus", ["Initiator", "Disabler"]), "2"],
    [hero(18, "Sven", ["Carry", "Disabler", "Initiator"]), "3"],
    [hero(26, "Lion", ["Support", "Disabler", "Nuker"]), "3"],
    [hero(5, "Crystal Maiden", ["Support", "Disabler", "Nuker"]), "1"],
    [hero(1, "Anti-Mage", ["Carry", "Escape"]), "1"],
    [hero(67, "Spectre", ["Carry", "Durable"]), "2"],
    [hero(109, "Terrorblade", ["Carry", "Pusher"]), "3"],
    [hero(30, "Witch Doctor", ["Support", "Disabler", "Nuker"]), "3"],
    [hero(31, "Lich", ["Support", "Nuker"]), "1"],
  ];
  const even = { picks: Array(8).fill(1000), wins: Array(8).fill(500) };
  const positions: Record<string, number[]> = {
    94: [1000, 0, 0, 0, 0], 97: [0, 1000, 0, 0, 0], 18: [0, 0, 1000, 0, 0], 26: [0, 0, 0, 1000, 0], 5: [0, 0, 0, 0, 1000],
    1: [1000, 0, 0, 0, 0], 67: [0, 1000, 0, 0, 0], 109: [0, 0, 1000, 0, 0], 30: [0, 0, 0, 1000, 0], 31: [0, 0, 0, 0, 1000],
  };
  return {
    generatedAt: "2026-10-26T00:00:00Z",
    heroes: Object.fromEntries(heroes.map(([h]) => [h.id, h])),
    bracketStats: Object.fromEntries(heroes.map(([h]) => [h.id, even])),
    // Our safe lane (Medusa, CM) beats their off lane (Terrorblade, Witch Doctor) clearly.
    matchups: {
      94: { 109: { games: 2000, wins: 1300 } },
      109: { 94: { games: 2000, wins: 700 } },
    },
    synergy: {},
    laneRoles: Object.fromEntries(heroes.map(([h, lane]) => [h.id, { [lane]: 100 }])),
    positions,
  };
}

const ours = [
  { heroId: 94, position: 1 as const },
  { heroId: 97, position: 2 as const },
  { heroId: 18, position: 3 as const },
  { heroId: 26, position: 4 as const },
  { heroId: 5, position: 5 as const },
];
const theirs = [1, 67, 109, 30, 31];

describe("gamePlan", () => {
  it("needs all ten heroes", () => {
    expect(() => gamePlan(new Engine(data()), { ours: ours.slice(0, 4), theirs })).toThrow("all ten heroes");
  });

  it("guesses the lanes and calls a won lane", () => {
    const plan = gamePlan(new Engine(data()), { ours, theirs });
    const safe = plan.lanes.find((l) => l.name === "Safe lane")!;
    expect(safe.ours).toEqual([94, 5]);
    expect(safe.theirs).toEqual([109, 30]);
    expect(safe.verdict).toBe("win");
    expect(plan.lanes.find((l) => l.name === "Mid")!.verdict).toBe("even");
    expect(plan.roadmap[0]!.text).toContain("Press your edge in the safe lane");
  });

  it("names combos, hard counters and when to fight a late-game team", () => {
    const plan = gamePlan(new Engine(data()), { ours, theirs });
    expect(plan.ourCombos).toEqual(["Magnus + Sven: Reverse Polarity into Sven's God's Strength cleave"]);
    expect(plan.fears).toContain("Medusa is hard countered by Anti-Mage: play carefully around them");
    expect(plan.theirStyle?.key).toBe("lategame");
    expect(plan.winCondition).toContain("take fights and towers before 30 minutes");
    expect(plan.roadmap[1]!.text).toContain("This is your window");
  });

  it("gives every player a job, and no build without item data", () => {
    const plan = gamePlan(new Engine(data()), { ours, theirs });
    expect(plan.players.map((p) => p.position)).toEqual([1, 2, 3, 4, 5]);
    expect(plan.players[2]!.job).toContain("start the team's fights as Sven");
    expect(plan.players[1]!.job).toContain("Set up Reverse Polarity into Sven's God's Strength cleave with Sven");
    expect(plan.players.every((p) => p.build === null)).toBe(true);
  });
});
