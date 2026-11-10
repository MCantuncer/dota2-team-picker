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
    // Backups come from the pool too: a one-hero pool has none.
    expect(mid.alternatives).toEqual([]);
    const two = planTeam(new Engine(fixture()), { slots: [{ position: 2, playerId: "can", favorites: [2, 3] }] }).slots[1]!;
    expect(two.alternatives.map((a) => [a.name, a.inPool])).toEqual([["Mid Three", true]]);
  });

  it("plans a player from their pool even when a hero outside it scores much higher", () => {
    // Mid Three beats Offlane Five clearly, but only Mid Two is in the pool.
    const plan = planTeam(new Engine(fixture()), { slots: [{ position: 2, playerId: "can", favorites: [2] }], enemies: [5] });
    expect(plan.slots[1]).toMatchObject({ name: "Mid Two", inPool: true });
    expect(plan.slots.some((s) => s.name === "Mid Three")).toBe(false);
  });

  it("falls back to a hero outside the pool only when the pool is used up, and marks it", () => {
    // Both players have only Mid Two: one gets it, the other the best hero left for the slot.
    const plan = planTeam(new Engine(fixture()), {
      slots: [
        { position: 2, playerId: "can", favorites: [2] },
        { position: 3, playerId: "ali", favorites: [2] },
      ],
    });
    const [mid, off] = [plan.slots[1]!, plan.slots[2]!];
    expect([mid.name, mid.inPool]).toEqual(["Mid Two", true]);
    expect(off.inPool).toBe(false);
    expect(off.name).not.toBe("Mid Two");
    // The cost that keeps fallbacks out never shows in the team score.
    expect(Math.abs(plan.score)).toBeLessThan(100);
    // A banned pool hero leaves the slot to a marked fallback, not an error.
    const banned = planTeam(new Engine(fixture()), { slots: [{ position: 2, playerId: "can", favorites: [2] }], bans: [2] });
    expect(banned.slots[1]!.inPool).toBe(false);
  });

  it("gives the player's Top 5 the same small push inside the pool as the draft score", () => {
    const plan = (slot: { favorites?: number[]; top?: number[] }, enemies: number[] = []) =>
      planTeam(new Engine(fixture()), { slots: [{ position: 2, playerId: "can", ...slot }], enemies });
    const fav = plan({ favorites: [2, 3] }, [5]);
    const top = plan({ favorites: [2, 3], top: [3] }, [5]);
    expect(top.slots[1]!.name).toBe("Mid Three");
    expect(top.score - fav.score).toBeCloseTo(0.5);
    // Too small to make the three reasons shown next to a counter edge.
    expect(top.slots[1]!.reasons).not.toContain("One of the player's Top 5");
    // A hero outside the pool gets nothing, and a Top 5 hero still loses to a clear counter edge.
    expect(plan({ top: [2] })).toEqual(plan({}));
    expect(plan({ favorites: [2, 3], top: [2] }, [5]).slots[1]!.name).toBe("Mid Three");
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
