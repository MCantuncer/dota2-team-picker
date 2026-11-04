import { describe, expect, it } from "vitest";
import { enemyList, threatRows, type EnemyNote, type ThreatRow } from "../src/engine/enemy-list";
import type { ItemBuild } from "../src/engine/item-build";
import type { HeroInfo } from "../src/engine/types";

const hero = (id: number, name: string, roles: string[]): HeroInfo => ({ id, name, roles, attackType: "Melee", primaryAttr: "str" });
const AXE = hero(2, "Axe", ["Initiator", "Durable", "Disabler"]);
const PA = hero(44, "Phantom Assassin", ["Carry", "Escape"]);
const LICH = hero(31, "Lich", ["Support", "Nuker"]);

const build = (): ItemBuild => ({
  timings: "rank",
  start: [{ itemId: 39, name: "Healing Salve", img: "", minute: 0, phase: "start", draft: true, against: [2] }],
  lane: [],
  core: [{ itemId: 145, name: "Monkey King Bar", img: "", minute: 33, phase: "late", draft: true, against: [44] }],
  situational: [],
});

describe("enemyList", () => {
  const list = () =>
    enemyList(build(), [
      { hero: PA, inLane: false, laneSure: true },
      { hero: AXE, inLane: true, laneSure: true },
      { hero: LICH, inLane: true, laneSure: false },
    ]);

  it("puts the lane enemies first, with how sure their lane is", () => {
    expect(list().map((e) => [e.heroId, e.inLane, e.laneSure])).toEqual([
      [2, true, true],
      [31, true, false],
      [44, false, true],
    ]);
  });

  it("names each hero's most dangerous spell, and none for a hero not in the list", () => {
    expect(list().find((e) => e.heroId === 2)!.spell).toEqual({ key: "axe_berserkers_call", name: "Berserker's Call", line: "Forces you to hit him while his team arrives" });
    const unknown = enemyList(null, [{ hero: hero(999, "New Hero", []), inLane: false, laneSure: false }]);
    expect(unknown[0]?.spell).toBeUndefined();
  });

  it("names the items that answer a hero, and a tip when none does", () => {
    const pa = list().find((e) => e.heroId === 44)!;
    expect(pa).toMatchObject({ threat: "Evasion: right clicks miss", answers: [145] });
    expect(pa.tip).toBeUndefined();
    // The hard lane's Salve is for the lane, not an answer to Axe.
    const axe = list().find((e) => e.heroId === 2)!;
    expect(axe).toMatchObject({ threat: "Starts fights and soaks your damage", answers: [] });
    expect(axe.tip).toContain("Don't focus them");
  });

  it("says when a hero needs nothing special", () => {
    const [sniper] = enemyList(null, [{ hero: hero(999, "Test Hero", []), inLane: false, laneSure: false }]);
    expect(sniper).toMatchObject({ threat: "No special threat", answers: [] });
    expect(enemyList(null, [{ hero: LICH, inLane: false, laneSure: false }])[0]!.threat).toBe("Magic burst");
  });
});

describe("threatRows", () => {
  const note = (heroId: number, threat: string, answers: number[], tip?: string, inLane = false): EnemyNote => ({
    heroId,
    inLane,
    laneSure: true,
    threat,
    answers,
    ...(tip ? { tip } : {}),
  });
  const ids = (rows: ThreatRow[]) => rows.map((r) => [r.enemies.map((e) => e.heroId), r.answer ?? r.tip]);

  it("says one answer once: every enemy it answers shares a row, each with its own threat", () => {
    const dust = "Ask your support for Dust and Sentries before fights";
    const rows = threatRows([
      note(84, "Saves allies with buffs", [116], undefined, true),
      note(33, "Locks you down", [116], undefined, true),
      note(30, "Heals their team through fights", [116]),
      note(56, "Goes invisible", [], dust),
    ]);
    expect(ids(rows)).toEqual([
      [[84, 33, 30], 116],
      [[56], dust],
    ]);
    expect(rows[0]?.enemies.map((e) => [e.threat, e.inLane])).toEqual([
      ["Saves allies with buffs", true],
      ["Locks you down", true],
      ["Heals their team through fights", false],
    ]);
  });

  it("puts an enemy with several answers under the one that covers the most enemies", () => {
    // Linken's (1) comes first in the path but answers only hero 10; Black King Bar (116) answers both.
    const rows = threatRows([note(10, "Locks you down", [1, 116]), note(11, "Locks you down", [116])]);
    expect(ids(rows)).toEqual([[[10, 11], 116]]);
    // A tie keeps path order.
    expect(ids(threatRows([note(12, "Magic burst", [2, 3])]))).toEqual([[[12], 2]]);
  });

  it("groups enemies with no answer by their shared threat, and leaves out a tip it doesn't have", () => {
    const tip = "Stay spread so one combo can't catch two";
    const rows = threatRows([note(1, "Magic burst", [], tip), note(2, "Locks you down", [9]), note(3, "Magic burst", [], tip), note(4, "No special threat", [])]);
    expect(ids(rows)).toEqual([
      [[1, 3], tip],
      [[2], 9],
      [[4], undefined],
    ]);
    expect(rows[2]).not.toHaveProperty("tip");
  });
});
