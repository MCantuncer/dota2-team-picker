import { describe, expect, it } from "vitest";
import { DISPELLABLE_BUFFS } from "../src/engine/data-dispellable-buffs";
import { PIERCES_BKB } from "../src/engine/data-key-spells";
import { buffsFrom, dispellableBuffs } from "../src/engine/dispel";
import { enemyList } from "../src/engine/enemy-list";
import { itemBuild, threatsOf } from "../src/engine/item-build";
import { itemEffect } from "../src/engine/item-effects";
import { spellFact } from "../src/engine/spell-facts";
import type { HeroInfo, ItemInfo, Snapshot } from "../src/engine/types";

const hero = (id: number, name: string, roles: string[]): HeroInfo => ({ id, name, roles, attackType: "Melee", primaryAttr: "agi" });
const ANTI_MAGE = hero(1, "Anti-Mage", ["Carry", "Escape", "Nuker"]);
const NECROPHOS = hero(36, "Necrophos", ["Carry", "Nuker", "Durable", "Disabler"]);
const PUGNA = hero(45, "Pugna", ["Nuker", "Pusher"]);
const TEMPLAR = hero(46, "Templar Assassin", ["Carry", "Escape"]);
const DAZZLE = hero(50, "Dazzle", ["Support", "Nuker", "Disabler"]);
const LEGION = hero(104, "Legion Commander", ["Carry", "Disabler", "Initiator", "Durable", "Nuker"]);

describe("spell lists checked against the game facts", () => {
  it("lists only buffs a basic dispel removes", () => {
    for (const key of DISPELLABLE_BUFFS) expect(spellFact(key)?.removedBy, key).toBe("basic");
  });

  it("lists only key spells the facts say go through Black King Bar", () => {
    for (const key of Object.keys(PIERCES_BKB)) expect(spellFact(key)?.piercesBkb, key).toBe(true);
  });
});

describe("dispellable buffs", () => {
  it("finds Decrepify and Ghost Shroud, and nothing for Shallow Grave or Refraction", () => {
    expect(dispellableBuffs(PUGNA).map((s) => s.name)).toEqual(["Decrepify"]);
    expect(dispellableBuffs(NECROPHOS).map((s) => s.name)).toEqual(["Ghost Shroud"]);
    expect(dispellableBuffs(DAZZLE)).toEqual([]);
    expect(dispellableBuffs(TEMPLAR)).toEqual([]);
    expect(buffsFrom([PUGNA, DAZZLE, NECROPHOS])).toEqual(["Decrepify from Pugna", "Ghost Shroud from Necrophos"]);
  });

  it("gives Pugna and Necrophos the buffs threat, not Dazzle or Templar Assassin", () => {
    expect(threatsOf(PUGNA).has("buffs")).toBe(true);
    expect(threatsOf(NECROPHOS).has("buffs")).toBe(true);
    expect(threatsOf(DAZZLE).has("buffs")).toBe(false);
    expect(threatsOf(TEMPLAR).has("buffs")).toBe(false);
  });

  it("names each buff Nullifier removes in its line", () => {
    expect(itemEffect("nullifier", [PUGNA, NECROPHOS, DAZZLE])).toEqual({
      line: "Dispels Decrepify from Pugna and Ghost Shroud from Necrophos.",
      against: [45, 36],
    });
    expect(itemEffect("nullifier", [DAZZLE, TEMPLAR])?.line).toBe("Dispels buffs on your target and slows it.");
  });

  it("doesn't head Legion Commander's threat row with her buff", () => {
    const [row] = enemyList(null, [{ hero: LEGION, inLane: false, laneSure: true }]);
    expect(row?.threat).not.toContain("buffs");
  });
});

describe("Nullifier in the item build", () => {
  const item = (key: string, name: string, cost: number): ItemInfo => ({ key, name, cost, img: `/${key}.png`, components: [] });
  /** An Anti-Mage whose players buy Nullifier often enough to pass the popularity cut. */
  const data = (): Snapshot => ({
    generatedAt: "",
    heroes: Object.fromEntries([ANTI_MAGE, NECROPHOS, PUGNA, TEMPLAR, DAZZLE].map((h) => [h.id, h])),
    bracketStats: {},
    matchups: {},
    synergy: {},
    laneRoles: {},
    items: {
      63: item("power_treads", "Power Treads", 1400),
      145: item("bfury", "Battle Fury", 4100),
      147: item("manta", "Manta Style", 4650),
      225: item("nullifier", "Nullifier", 4350),
    },
    itemBuilds: { 1: { start: {}, early: { 63: 100 }, mid: { 145: 100, 147: 90 }, late: { 225: 20 } } },
  });

  it("offers Nullifier against Pugna and Necrophos, naming the buffs it removes", () => {
    const build = itemBuild(data(), 1, 1, [36, 45])!;
    const nullifier = [...build.core, ...build.situational].find((i) => i.name === "Nullifier");
    expect(nullifier?.reason).toMatch(/^Dispels Ghost Shroud from Necrophos and Decrepify from Pugna/);
    expect(nullifier?.against).toEqual([36, 45]);
  });

  it("doesn't offer it against Dazzle and Templar Assassin, whose saves no dispel removes", () => {
    const build = itemBuild(data(), 1, 1, [50, 46])!;
    expect([...build.core, ...build.situational].find((i) => i.name === "Nullifier")?.reason).toBeUndefined();
  });
});
