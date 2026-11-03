import { describe, expect, it } from "vitest";
import { enemyList, threatGroups, type EnemyNote } from "../src/engine/enemy-list";
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

describe("threatGroups", () => {
  const note = (heroId: number, threat: string, answers: number[], tip?: string): EnemyNote => ({
    heroId,
    inLane: false,
    laneSure: true,
    threat,
    answers,
    ...(tip ? { tip } : {}),
  });

  it("says one answer once: every enemy it answers shares a row", () => {
    // Can's Wraith King card (2026-11-03) said "Buy Black King Bar" for Ogre Magi, Enigma and Witch Doctor.
    const rows = threatGroups([
      note(84, "Saves allies with buffs", [116]),
      note(33, "Locks you down", [116]),
      note(30, "Heals their team through fights", [116]),
      note(56, "Goes invisible", [], "Ask your support for Dust and Sentries before fights"),
      note(8, "Right-click carry who grows late", [], "Fight before their big item, not after"),
    ]);
    expect(rows).toEqual([
      { heroIds: [84, 33, 30], threats: ["Saves allies with buffs", "Locks you down", "Heals their team through fights"], answer: 116 },
      { heroIds: [56], threats: ["Goes invisible"], tip: "Ask your support for Dust and Sentries before fights" },
      { heroIds: [8], threats: ["Right-click carry who grows late"], tip: "Fight before their big item, not after" },
    ]);
  });

  it("groups enemies with no answer by their shared threat, most common threat first", () => {
    const tip = "Stay spread so one combo can't catch two";
    const rows = threatGroups([note(1, "Magic burst", [], tip), note(2, "Locks you down", [1]), note(3, "Magic burst", [], tip)]);
    expect(rows).toEqual([
      { heroIds: [1, 3], threats: ["Magic burst"], tip },
      { heroIds: [2], threats: ["Locks you down"], answer: 1 },
    ]);
    expect(threatGroups([note(4, "Locks you down", [9]), note(5, "Magic burst", [9]), note(6, "Magic burst", [9])])[0]!.threats).toEqual([
      "Magic burst",
      "Locks you down",
    ]);
  });
});
