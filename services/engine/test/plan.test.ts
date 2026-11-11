import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COMBOS, STYLES } from "../src/engine/gameplan";
import { planTeam } from "../src/engine/plan";
import { clearMatchup, Engine } from "../src/engine/score";
import type { Snapshot } from "../src/engine/types";
import { fixture } from "./fixture";

/** The most picked carry in the data, to lock in a test. */
const plan0 = (engine: Engine) => [...engine.heroes].sort((a, b) => engine.pickRate(b.id) - engine.pickRate(a.id)).find((h) => engine.fit(h.id)[1] >= 0.5)!.id;

describe("planTeam", () => {
  it("plans a different hero for every position before the draft", () => {
    const plan = planTeam(new Engine(fixture()), { slots: [] });
    expect(plan.slots.map((s) => s.position)).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(plan.slots.map((s) => s.heroId)).size).toBe(5);
    expect(plan.slots[0]!.name).toBe("Carry One");
    expect(plan.slots[4]!.name).toBe("Support Six");
  });

  it("builds around the player's pool and gives every reason with its number", () => {
    const plan = planTeam(new Engine(fixture()), { slots: [{ position: 2, playerId: "can", favorites: [2] }] });
    const mid = plan.slots[1]!;
    expect(mid).toMatchObject({ name: "Mid Two", playerId: "can", inPool: true, locked: false });
    expect(mid.reasons).toContainEqual({ kind: "fit", lead: "100%", text: "of its games as mid" });
    // Every planned hero is from a pool here, so being in it never shows as a reason.
    expect(plan.slots.flatMap((s) => s.reasons).some((r) => r.kind === "pool")).toBe(false);
    for (const s of plan.slots) expect(s.reasons.length).toBeLessThanOrEqual(3);
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
    // The card says so, with the points it adds.
    expect(top.slots[1]!.reasons).toContainEqual(expect.objectContaining({ kind: "top", lead: "Top 5" }));
    // A hero outside the pool gets nothing, and a Top 5 hero still loses to a clear counter edge.
    expect(plan({ top: [2] })).toEqual(plan({}));
    expect(plan({ favorites: [2, 3], top: [2] }, [5]).slots[1]!.name).toBe("Mid Three");
  });

  it("keeps picked heroes and re-plans the rest around the enemy picks", () => {
    const plan = planTeam(new Engine(fixture()), {
      slots: [{ position: 1, heroId: 1 }],
      enemies: [5],
    });
    expect(plan.slots[0]).toMatchObject({ name: "Carry One", locked: true });
    // Offlane Five is taken by the enemy, and Mid Three counters it.
    expect(plan.slots[2]!.name).toBe("Offlane Seven");
    expect(plan.slots[1]!.name).toBe("Mid Three");
    expect(plan.slots[1]!.reasons[0]).toEqual({ kind: "counter", lead: "+8.0", text: "against Offlane Five", heroes: [5] });
    // The picked hero is the one with the clearest role, so it brings the team's only right-click damage.
    expect(plan.slots[0]!.reasons[0]).toMatchObject({ kind: "need", lead: "Only", need: "physicalDamage" });
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
    expect(plan.slots[2]!.reasons[0]).toMatchObject({ kind: "combo", lead: "Combo", text: expect.stringMatching(/^with Snapfire: Arena/), heroes: [4] });
  });

  it("lists every team need with the heroes that cover it, and says how many are covered", () => {
    const plan = planTeam(new Engine(fixture()), { slots: [] });
    expect(plan.needs.map((n) => n.label)).toEqual(["Stun", "Initiator", "Save", "Frontliner", "Wave Clear", "Magic Damage", "Right-Click"]);
    const covered = plan.needs.filter((n) => n.heroes.length >= n.wanted).length;
    expect(plan.why).toContainEqual(expect.objectContaining({ kind: "need", lead: `${covered} of 7` }));
    for (const n of plan.needs) for (const id of n.heroes) expect(plan.slots.map((s) => s.heroId)).toContain(id);
  });

  it("picks first where waiting costs most against showing the hero, only while two or more are open", () => {
    const engine = new Engine(fixture());
    const plan = planTeam(engine, { slots: [] });
    const first = plan.pickFirst!;
    expect(plan.slots.find((s) => s.position === first.position)!.heroId).toBe(first.heroId);
    expect(first.takenChance).toBeGreaterThanOrEqual(0);
    expect(first.takenChance).toBeLessThanOrEqual(1);
    expect(first.gap).toBeGreaterThanOrEqual(0);
    expect(first.exposed).toBeGreaterThanOrEqual(0);
    expect(first.reason).toMatchObject({ lead: `${Math.round(first.takenChance * 100)}%`, text: expect.stringMatching(/^chance the enemy takes it; losing it costs the plan \d+\.\d, showing it now (costs|lets .+ answer it for) \d+\.\d$/) });
    const one = planTeam(engine, { slots: [1, 2, 3, 4].map((position) => ({ position: position as 1 | 2 | 3 | 4, heroId: position })) });
    expect(one.pickFirst).toBeNull();
  });

  it("counts the whole edge of a clear counter the enemy can still pick, and drops it once that counter is banned", () => {
    const engine = new Engine(JSON.parse(readFileSync("test/fixtures/golden-snapshot.json", "utf8")) as Snapshot);
    const ids = engine.heroes.map((h) => h.id);
    const hasCounter = (id: number) =>
      ids.some((e) => e !== id && clearMatchup({ edge: engine.matchupEdge(id, e), error: engine.matchupError(id, e) }) < 0);
    // Leave open only the two planned heroes that have a clear counter, so the one picked first has one too.
    const five = planTeam(engine, { slots: [] }).slots;
    const open = five.filter((s) => hasCounter(s.heroId)).slice(0, 2);
    expect(open).toHaveLength(2);
    const slots = five.map((s) => ({ position: s.position, ...(open.includes(s) ? { favorites: [s.heroId] } : { heroId: s.heroId }) }));
    const plan = planTeam(engine, { slots });
    const { counter, exposed, reason } = plan.pickFirst!;
    expect(counter!.edge).toBeLessThan(0);
    expect(exposed).toBeGreaterThanOrEqual(-counter!.edge);
    expect(reason.text).toContain(`lets ${engine.hero(counter!.heroId).name} answer it for ${(-counter!.edge).toFixed(1)}`);
    const banned = planTeam(engine, { slots, bans: [counter!.heroId] });
    expect(banned.pickFirst!.counter?.heroId).not.toBe(counter!.heroId);
  });

  it("with all five enemies in, nothing is left to lose or fear, so the most picked open hero goes first", () => {
    const data = JSON.parse(readFileSync("test/fixtures/golden-snapshot.json", "utf8")) as Snapshot;
    const engine = new Engine(data);
    const open = planTeam(engine, { slots: [] });
    const enemies = engine.heroes.map((h) => h.id).filter((id) => !open.slots.some((s) => s.heroId === id)).slice(0, 5);
    const plan = planTeam(engine, { slots: [], enemies });
    expect(plan.pickFirst).toMatchObject({ takenChance: 0, exposed: 0 });
    const rates = plan.slots.map((s) => engine.pickRate(s.heroId));
    expect(plan.pickFirst!.heroId).toBe(plan.slots[rates.indexOf(Math.max(...rates))]!.heroId);
  });

  it("builds Another Super Team with a different hero in every open slot, and says how far behind it is", () => {
    const data = JSON.parse(readFileSync("test/fixtures/golden-snapshot.json", "utf8")) as Snapshot;
    const engine = new Engine(data);
    const plan = planTeam(engine, { slots: [{ position: 1, heroId: plan0(engine) }] });
    const another = plan.another!;
    expect(another.slots[0]).toMatchObject({ heroId: plan.slots[0]!.heroId, locked: true, same: true });
    for (const s of another.slots.slice(1)) {
      expect(s.same).toBe(false);
      expect(s.heroId).not.toBe(plan.slots[s.position - 1]!.heroId);
    }
    expect(another.behind).toBeGreaterThanOrEqual(0);
    expect(another.behind).toBeCloseTo(plan.score - another.score, 0);
    expect(another.verdict).toMatch(/^(Level with the plan\.|\d+\.\d points behind: .+\.)$/);
    expect(another.needs).toHaveLength(7);
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
