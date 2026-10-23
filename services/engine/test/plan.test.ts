import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COMBOS, STYLES } from "../src/engine/gameplan";
import { planTeam } from "../src/engine/plan";
import { Engine } from "../src/engine/score";
import type { Snapshot } from "../src/engine/types";
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

  it("finds known combos and a shared style, and says how to play", () => {
    const data = fixture();
    // Rename three heroes so the fixture has a combo (Mars + Snapfire) and three teamfight heroes.
    data.heroes[3]!.name = "Puck";
    data.heroes[4]!.name = "Snapfire";
    data.heroes[5]!.name = "Mars";
    const plan = planTeam(new Engine(data), { slots: [] });
    expect(plan.combos).toEqual([{ heroes: ["Mars", "Snapfire"], text: expect.stringMatching(/Arena/) }]);
    expect(plan.style).toMatchObject({ key: "teamfight", heroes: 3 });
    expect(plan.gamePlan).toMatch(/^Teamfight: .* Key combo: Mars \+ Snapfire/);
    expect(plan.slots[2]!.reasons[0]).toMatch(/^Combo with Snapfire/);
  });

  it("calls a team without a shared style balanced", () => {
    expect(planTeam(new Engine(fixture()), { slots: [] }).gamePlan).toMatch(/^Balanced/);
  });

  it("only names heroes that exist in the hero data", () => {
    const data = JSON.parse(readFileSync("data/snapshot.json", "utf8")) as Snapshot;
    const names = new Set(Object.values(data.heroes).map((h) => h.name));
    const listed = [...Object.values(STYLES).flatMap((s) => s.heroes), ...COMBOS.flatMap((c) => c.heroes)];
    expect(listed.filter((n) => !names.has(n))).toEqual([]);
  });

  it("rejects a position listed twice", () => {
    expect(() => planTeam(new Engine(fixture()), { slots: [{ position: 2 }, { position: 2 }] })).toThrow(/twice/);
  });
});
