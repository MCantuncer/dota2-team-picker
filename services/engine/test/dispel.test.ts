import { describe, expect, it } from "vitest";
import { PIERCES_BKB } from "../src/engine/data-key-spells";
import { SPELL_FACTS } from "../src/engine/data-spell-facts";
import { SPELL_LANDING } from "../src/engine/data-spell-landing";
import { buffsFrom, dispellableBuffs } from "../src/engine/dispel";
import { enemyList } from "../src/engine/enemy-list";
import { itemBuild, threatsOf } from "../src/engine/item-build";
import { itemEffect } from "../src/engine/item-effects";
import { effectsOn, landsOn, spellFact } from "../src/engine/spell-facts";
import type { HeroInfo, ItemInfo, Snapshot } from "../src/engine/types";

const hero = (id: number, name: string, roles: string[]): HeroInfo => ({ id, name, roles, attackType: "Melee", primaryAttr: "agi" });
const ANTI_MAGE = hero(1, "Anti-Mage", ["Carry", "Escape", "Nuker"]);
const NECROPHOS = hero(36, "Necrophos", ["Carry", "Nuker", "Durable", "Disabler"]);
const PUGNA = hero(45, "Pugna", ["Nuker", "Pusher"]);
const TEMPLAR = hero(46, "Templar Assassin", ["Carry", "Escape"]);
const DAZZLE = hero(50, "Dazzle", ["Support", "Nuker", "Disabler"]);
const LEGION = hero(104, "Legion Commander", ["Carry", "Disabler", "Initiator", "Durable", "Nuker"]);
const OGRE = hero(84, "Ogre Magi", ["Support", "Nuker", "Disabler", "Durable", "Initiator"]);
const LICH = hero(31, "Lich", ["Support", "Nuker"]);
const ABADDON = hero(102, "Abaddon", ["Support", "Carry", "Durable"]);
const TREANT = hero(83, "Treant Protector", ["Support", "Initiator", "Durable", "Disabler", "Escape"]);
const WINDRANGER = hero(21, "Windranger", ["Carry", "Support", "Disabler", "Escape", "Nuker"]);

const allSpells = Object.values(SPELL_FACTS).flat();

describe("spell facts cover every hero", () => {
  it("says where every dispellable spell's effect lands, so a new hero or patch must be reviewed", () => {
    const missing = allSpells.filter((s) => (s.removedBy === "basic" || s.removedBy === "strong") && !landsOn(s.key)).map((s) => s.key);
    expect(missing).toEqual([]);
  });

  it("reviews only spells the facts have, and only where the cast target can't say", () => {
    const keys = new Set(allSpells.map((s) => s.key));
    for (const key of Object.keys(SPELL_LANDING)) {
      expect(keys.has(key), key).toBe(true);
      expect(spellFact(key)?.target, key).not.toBe("enemies");
    }
  });

  it("gives effects only to spells that land on the caster's team", () => {
    for (const [key, entry] of Object.entries(SPELL_LANDING)) if (entry.lands === "enemies") expect(effectsOn(key), key).toEqual([]);
  });

  it("lists only key spells the facts say go through Black King Bar", () => {
    for (const key of Object.keys(PIERCES_BKB)) expect(spellFact(key)?.piercesBkb, key).toBe(true);
  });
});

describe("buffs that stop attacks", () => {
  it("finds Decrepify and Ghost Shroud from the facts, and nothing for Shallow Grave or Refraction", () => {
    expect(dispellableBuffs(PUGNA, "unattackable").map((s) => s.name)).toEqual(["Decrepify"]);
    expect(dispellableBuffs(NECROPHOS, "unattackable").map((s) => s.name)).toEqual(["Ghost Shroud"]);
    expect(dispellableBuffs(DAZZLE, "unattackable")).toEqual([]);
    expect(dispellableBuffs(TEMPLAR, "unattackable")).toEqual([]);
    expect(buffsFrom([PUGNA, DAZZLE, NECROPHOS], "unattackable")).toEqual(["Decrepify from Pugna", "Ghost Shroud from Necrophos"]);
  });

  it("are only Decrepify and Ghost Shroud across all heroes today", () => {
    const found = allSpells.filter((s) => s.removedBy === "basic" && effectsOn(s.key).includes("unattackable")).map((s) => s.name);
    expect(found.sort()).toEqual(["Decrepify", "Ghost Shroud"]);
  });

  it("marks a buff an upgrade can make undispellable", () => {
    expect(buffsFrom([WINDRANGER], "evasion")).toEqual(["Windrun from Windranger (unless upgraded)"]);
  });

  it("gives Pugna and Necrophos the threat, not Dazzle, Templar Assassin or heroes whose buffs don't stop attacks", () => {
    expect(threatsOf(PUGNA).has("unattackable")).toBe(true);
    expect(threatsOf(NECROPHOS).has("unattackable")).toBe(true);
    for (const h of [DAZZLE, TEMPLAR, OGRE, LICH, ABADDON, TREANT, WINDRANGER, LEGION]) expect(threatsOf(h).has("unattackable"), h.name).toBe(false);
  });

  it("names each buff Nullifier removes in its line", () => {
    expect(itemEffect("nullifier", [PUGNA, NECROPHOS, DAZZLE])).toEqual({
      line: "Dispels Decrepify from Pugna and Ghost Shroud from Necrophos.",
      against: [45, 36],
    });
    expect(itemEffect("nullifier", [DAZZLE, TEMPLAR])?.line).toBe("Dispels buffs on your target and slows it.");
  });

  it("heads Pugna's threat row with the buff only when nothing tells more", () => {
    const [row] = enemyList(null, [{ hero: PUGNA, inLane: false, laneSure: true }]);
    expect(row?.threat).not.toBe("Makes heroes unable to be attacked");
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
    expect(nullifier?.reason).toMatch(/^Removes Ghost Shroud from Necrophos and Decrepify from Pugna, which stop your attacks/);
    expect(nullifier?.against).toEqual([36, 45]);
  });

  it("doesn't offer it against Dazzle and Templar Assassin, whose saves no dispel removes", () => {
    const build = itemBuild(data(), 1, 1, [50, 46])!;
    expect([...build.core, ...build.situational].find((i) => i.name === "Nullifier")?.reason).toBeUndefined();
  });

  it("doesn't offer it against buffs that don't stop attacks: Bloodlust, Frost Shield, Aphotic Shield, Living Armor", () => {
    const d = data();
    for (const h of [OGRE, LICH, ABADDON, TREANT]) d.heroes[h.id] = h;
    const build = itemBuild(d, 1, 1, [84, 31, 102, 83])!;
    expect([...build.core, ...build.situational].find((i) => i.name === "Nullifier")?.reason).toBeUndefined();
  });
});
