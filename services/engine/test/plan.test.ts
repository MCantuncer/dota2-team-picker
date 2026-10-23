import { describe, expect, it } from "vitest";
import { planTeam } from "../src/engine/plan";
import { Engine } from "../src/engine/score";
import { fixture } from "./fixture";

describe("planTeam", () => {
  it("plans a different hero for every position before the draft", () => {
    const plan = planTeam(new Engine(fixture()), { slots: [] });
    expect(plan.slots.map((s) => s.position)).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(plan.slots.map((s) => s.heroId)).size).toBe(5);
    expect(plan.slots[0]!.name).toBe("Carry One");
    expect(plan.slots[4]!.name).toBe("Support Six");
  });

  it("builds around the player's pool and lists backups", () => {
    const plan = planTeam(new Engine(fixture()), { slots: [{ position: 2, playerId: "can", favorites: [2] }] });
    const mid = plan.slots[1]!;
    expect(mid).toMatchObject({ name: "Mid Two", playerId: "can", inPool: true, locked: false });
    expect(mid.reasons).toContain("From the player's hero pool");
    expect(mid.alternatives[0]).toMatchObject({ name: "Mid Three", inPool: false });
    expect(mid.alternatives[0]!.scoreDelta).toBeLessThan(0);
  });

  it("keeps picked heroes and re-plans the rest around the enemy picks", () => {
    const plan = planTeam(new Engine(fixture()), {
      slots: [{ position: 1, heroId: 1 }],
      enemies: [5],
    });
    expect(plan.slots[0]).toMatchObject({ name: "Carry One", locked: true, alternatives: [] });
    // Offlane Five is taken by the enemy, and Mid Three counters it.
    expect(plan.slots[2]!.name).toBe("Offlane Seven");
    expect(plan.slots[1]!.name).toBe("Mid Three");
    expect(plan.slots[1]!.reasons[0]).toMatch(/Strong against Offlane Five/);
  });

  it("skips banned heroes and says what the team still lacks", () => {
    const plan = planTeam(new Engine(fixture()), { slots: [], bans: [5] });
    expect(plan.slots.map((s) => s.heroId)).not.toContain(5);
    expect(plan.missing).toContain("an initiator");
  });

  it("rejects a position listed twice", () => {
    expect(() => planTeam(new Engine(fixture()), { slots: [{ position: 2 }, { position: 2 }] })).toThrow(/twice/);
  });
});
