import { describe, expect, it } from "vitest";
import { heroLines, lineTone, MAX_LINE_LENGTH, patchNotes } from "../src/data/patch-notes";

describe("lineTone", () => {
  it("reads buffs and nerfs from the words, and leaves unclear lines unmarked", () => {
    expect(lineTone("Cooldown decreased from 16/15/14/13s to 15/14/13/12s")).toBe(1);
    expect(lineTone("Damage decreased from 175-575 to 175-495")).toBe(-1);
    expect(lineTone("Mana Cost increased from 30 to 45")).toBe(-1);
    expect(lineTone("Evasion decreased from 25% to 20%")).toBe(-1);
    expect(lineTone("Level 10 Talent Stifling Dagger Cooldown Reduction increased from 2s to 2.5s")).toBe(1);
    expect(lineTone("Bounty increased from 70 to 100")).toBe(0);
    expect(lineTone("Disarm is now dispellable")).toBe(0);
  });
});

describe("heroLines", () => {
  const names = { invoker_sun_strike: "Sun Strike", invoker_chaos_meteor: "Chaos Meteor", invoker_deafening_blast: "Deafening Blast" };

  it("keeps one line per ability, numbers first, and counts every change", () => {
    const out = heroLines(
      {
        invoker_sun_strike: ["Damage decreased from 175-575 to 175-495", "From 175/225/275 to 175/215/255"],
        invoker_sun_strike_info: ["As a part of the comprehensive Spell Power Reduction"],
        invoker_deafening_blast: ["Disarm is now dispellable"],
        invoker_chaos_meteor: ["Burn Damage per second rescaled from 10-50 to 12-44"],
        talents: ["Level 10 Talent Ice Wall DPS decreased from +50 to +40"],
        general: ["x".repeat(MAX_LINE_LENGTH + 1)],
      },
      names,
    );
    expect(out.changes).toBe(5);
    expect(out.lines).toEqual([
      { ability: "Sun Strike", text: "Damage decreased from 175-575 to 175-495", tone: -1 },
      { ability: "Chaos Meteor", text: "Burn Damage per second rescaled from 10-50 to 12-44", tone: 0 },
      { ability: "Deafening Blast", text: "Disarm is now dispellable", tone: 0 },
    ]);
  });
});

describe("patchNotes", () => {
  it("joins the patch with its letter patches and keys heroes by id", () => {
    const constants = {
      "7_41": { heroes: { invoker: { general: ["Old change increased from 1 to 2"] } } },
      "7_42": { heroes: { invoker: { invoker_sun_strike: ["Damage decreased from 175-575 to 175-495"] } } },
      "7_42a": { heroes: { invoker: { general: ["Base Intelligence increased from 19 to 20"] }, axe: {} } },
    };
    const out = patchNotes(constants, "7.42", { 74: "npc_dota_hero_invoker", 2: "npc_dota_hero_axe" }, { invoker_sun_strike: "Sun Strike" });
    expect(Object.keys(out)).toEqual(["74"]);
    expect(out[74]!.changes).toBe(2);
    expect(out[74]!.lines.map((l) => l.ability)).toEqual(["Sun Strike", "Hero"]);
  });
});
