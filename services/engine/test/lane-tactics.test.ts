import { describe, expect, it } from "vitest";
import { firstLevelOf, levelFor, spellLevelsAt } from "../src/engine/lane-skills";
import { laneTactics, MAX_TACTICS, type LaneTactic } from "../src/engine/lane-tactics";
import type { HeroAbility, Snapshot } from "../src/engine/types";

// Ability ids, slots and the first ten skill points high-rank players took on 7.42 (STRATZ guides).
const abilities: Record<number, [id: number, key: string, slot: number, ultimate?: true][]> = {
  36: [
    [5158, "necrolyte_death_pulse", 1],
    [1270, "necrolyte_ghost_shroud", 2],
    [5159, "necrolyte_heartstopper_aura", 3],
    [5161, "necrolyte_reapers_scythe", 6, true],
  ],
  25: [
    [5040, "lina_dragon_slave", 1],
    [5041, "lina_light_strike_array", 2],
    [5042, "lina_fiery_soul", 3],
    [5043, "lina_laguna_blade", 6, true],
  ],
  74: [
    [5370, "invoker_quas", 1],
    [5371, "invoker_wex", 2],
    [5372, "invoker_exort", 3],
    [5385, "invoker_chaos_meteor", 12],
    [5386, "invoker_sun_strike", 13],
    [5387, "invoker_forge_spirit", 14],
  ],
  97: [
    [5518, "magnataur_shockwave", 1],
    [5519, "magnataur_empower", 2],
    [5520, "magnataur_skewer", 3],
    [5521, "magnataur_reverse_polarity", 6, true],
  ],
  14: [
    [5075, "pudge_meat_hook", 1],
    [5076, "pudge_rot", 2],
    [5074, "pudge_flesh_heap", 3],
    [5077, "pudge_dismember", 6, true],
  ],
  35: [
    [5154, "sniper_shrapnel", 1],
    [5155, "sniper_headshot", 2],
    [5156, "sniper_take_aim", 3],
    [5157, "sniper_assassinate", 6, true],
  ],
};
const builds: Record<number, Record<string, number[]>> = {
  36: { "2": [5158, 5159, 5158, 1270, 5158, 5161, 5158, 5159, 5159, 5159] },
  25: { "2": [5040, 5042, 5040, 5041, 5040, 5043, 5040, 5042, 5042, 5042] },
  74: { "2": [5372, 5370, 5372, 5370, 5372, 5370, 5371, 5372, 5370, 5372] },
  97: { "3": [5518, 5520, 5518, 5520, 5518, 5521, 5518, 5520, 5520, 5519] },
  14: { "3": [5075, 5076, 5076, 5074, 5076, 5077, 5076, 5074, 5074, 5074] },
  // Sniper has no agreed build: the even opening stands in.
};

function snapshot(): Snapshot {
  const heroAbilities = Object.fromEntries(
    Object.entries(abilities).map(([id, list]) => [
      id,
      { abilities: list.map(([aid, key, slot, ultimate]): HeroAbility => ({ id: aid, key, name: key, slot, maxLevel: 0, ultimate: !!ultimate })), talents: [] },
    ]),
  );
  const skillBuilds = Object.fromEntries(
    Object.entries(builds).map(([id, slices]) => [
      id,
      Object.fromEntries(
        Object.entries(slices).map(([pos, levels]) => [pos, { at: "2026-11-20T00:00:00Z", gameVersionId: 184, matches: 50, talents: [], build: { levels, groupMatches: 40, share: 0.8, exactMatches: 30 } }]),
      ),
    ]),
  );
  // Necrophos mid gets 49 last hits against Lina, 52.1 on average over his lanes; Lina gets 55 against him.
  const laneOutcomes = {
    "0": {
      "36": { "25": [2000, 600, 600, 800, 49], "14": [800, 400, 200, 200, 60] },
      "25": { "36": [2000, 800, 600, 600, 55] },
      // Too few lanes for a target.
      "74": { "97": [200, 50, 50, 100, 40] },
    },
  };
  return { heroAbilities, skillBuilds, laneOutcomes } as unknown as Snapshot;
}

const NAMES: Record<number, string> = { 36: "Necrophos", 25: "Lina", 74: "Invoker", 97: "Magnus", 14: "Pudge", 35: "Sniper" };
const name = (id: number) => NAMES[id] ?? String(id);
const text = (t: LaneTactic) => t.parts.map((p) => p.text).join("");
const byRule = (list: LaneTactic[], rule: string) => list.find((t) => t.rule === rule);

describe("spell levels", () => {
  const data = snapshot();

  it("follow the high-rank build, falling back to another position's build", () => {
    const necro = spellLevelsAt(data, 36, 2, 6);
    expect(necro?.get("necrolyte_death_pulse")).toBe(3);
    expect(necro?.get("necrolyte_reapers_scythe")).toBe(1);
    // Magnus only has a position 3 build.
    expect(spellLevelsAt(data, 97, 2, 3)?.get("magnataur_shockwave")).toBe(2);
  });

  it("use an even opening without a build, and never claim when players take a spell from it", () => {
    const sniper = spellLevelsAt(data, 35, 2, 6);
    expect([...(sniper?.values() ?? [])].sort()).toEqual([1, 1, 2, 2]);
    expect(sniper?.get("sniper_assassinate")).toBe(1);
    expect(firstLevelOf(data, 35, 2, "sniper_shrapnel")).toBeUndefined();
    expect(firstLevelOf(data, 25, 2, "lina_light_strike_array")).toBe(4);
  });

  it("level an orb spell's summon by its orb", () => {
    const invoker = spellLevelsAt(data, 74, 2, 3);
    expect(invoker && levelFor(invoker, "invoker_forge_spirit", "summonHealth")).toBe(1);
  });

  it("are undefined for a hero without an ability list", () => {
    expect(spellLevelsAt(data, 1, 2, 3)).toBeUndefined();
  });
});

describe("laneTactics", () => {
  const data = snapshot();

  it("gives Necrophos against Lina a kill line, Death Pulse when Lina steps in, and the reach gap", () => {
    const list = laneTactics(data, { id: 36, position: 2 }, { id: 25, position: 2 }, name);
    expect(list.length).toBeLessThanOrEqual(MAX_TACTICS);
    expect(list[0]?.rule).toBe("killLine");
    expect(text(list[0]!)).toMatch(/^Once Lina is level 6, stay above \d+ HP\. /);
    const kill = list[0]!.visual;
    expect(kill?.kind === "killLine" && kill.total < kill.health && kill.total >= kill.health * 0.4).toBe(true);
    expect(byRule(list, "yourSpell")?.title).toBe("Death Pulse When Lina Steps In");
    expect(byRule(list, "reach")?.title).toBe("Lina Outranges You by 170");
    // Every tactic names Lina, never "Their" or "Pos" wording.
    for (const t of list) expect(`${t.title} ${text(t)}`).not.toMatch(/Their|Pos \d|\u2014/);
  });

  it("tells Invoker to split from Forge Spirit against Magnus's Shockwave", () => {
    const list = laneTactics(data, { id: 74, position: 2 }, { id: 97, position: 2 }, name);
    const split = byRule(list, "split");
    expect(split?.title).toBe("Split From Your Forge Spirit");
    expect(split?.spells[0]).toBe("magnataur_shockwave");
    expect(split?.visual?.kind).toBe("split");
  });

  it("tells a mid to keep a creep between them and Pudge, because Meat Hook stops at the first unit", () => {
    const list = laneTactics(data, { id: 25, position: 2 }, { id: 14, position: 3 }, name);
    const line = byRule(list, "lineUp");
    expect(line?.title).toBe("Keep a Creep Between You and Pudge");
    expect(text(line!)).toMatch(/Meat Hook stops at the first unit/);
    expect(line?.visual).toEqual({ kind: "lineUp", width: 100, spell: "pudge_meat_hook", blocked: true });
  });

  it("counts at most two invoked spells in Invoker's kill line", () => {
    const list = laneTactics(data, { id: 25, position: 2 }, { id: 74, position: 2 }, name);
    const kill = byRule(list, "killLine");
    const invoked = kill?.spells.filter((k) => /chaos_meteor|sun_strike|forge_spirit/.test(k)) ?? [];
    expect(invoked.length).toBeLessThanOrEqual(2);
  });

  it("counts Reaper's Scythe in Necrophos's kill line as the health it executes from", () => {
    const list = laneTactics(data, { id: 25, position: 2 }, { id: 36, position: 2 }, name);
    const kill = byRule(list, "killLine");
    expect(kill?.spells).toContain("necrolyte_reapers_scythe");
    const scythe = kill?.visual?.kind === "killLine" ? kill.visual.parts.find((p) => p.spell === "necrolyte_reapers_scythe") : undefined;
    // 0.7 per missing point, after Lina's magic resistance: a hero at h dies when 0.7 x MR x (H - h) >= h.
    const health = kill?.visual?.kind === "killLine" ? kill.visual.health : 0;
    const perPoint = scythe ? scythe.amount / (health - scythe.amount) : 0;
    expect(perPoint).toBeGreaterThan(0.45);
    expect(perPoint).toBeLessThan(0.7);
  });

  it("ends with the last hit target against this enemy, the usual and the enemy's own", () => {
    const list = laneTactics(data, { id: 36, position: 2 }, { id: 25, position: 2 }, name);
    const target = list[list.length - 1];
    expect(target?.title).toBe("Last Hit Target: 49 by the End of Lane");
    expect(text(target!)).toBe("Necrophos players get 49 last hits in lane against Lina, 3 fewer than their usual 52. Lina gets 55 against you.");
    expect(target?.visual).toEqual({ kind: "lastHits", target: 49, usual: 52, enemy: 55 });
    expect(list.length).toBeLessThanOrEqual(MAX_TACTICS);
    // Under 300 lanes: no target.
    expect(laneTactics(data, { id: 74, position: 2 }, { id: 97, position: 2 }, name).some((t) => t.rule === "lastHits")).toBe(false);
  });

  it("returns one tactic per rule, biggest stake first", () => {
    const list = laneTactics(data, { id: 36, position: 2 }, { id: 25, position: 2 }, name);
    expect(new Set(list.map((t) => t.rule)).size).toBe(list.length);
    const ranked = list.filter((t) => t.rule !== "lastHits");
    for (let i = 1; i < ranked.length; i++) expect(ranked[i - 1]!.weight).toBeGreaterThanOrEqual(ranked[i]!.weight);
  });

  it("is empty when a hero has no lane facts or abilities", () => {
    expect(laneTactics(data, { id: 36, position: 2 }, { id: 1, position: 2 }, name)).toEqual([]);
  });
});
