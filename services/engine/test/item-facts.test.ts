import { describe, expect, it } from "vitest";
import { toItemFacts } from "../src/data/item-facts";
import { ITEM_FACTS } from "../src/engine/data-item-facts";
import { dispelsEnemy, itemFact } from "../src/engine/item-facts";

const ability = (type: string, description: string) => ({ type, description });

/** Trimmed rows of OpenDota's /constants/items as of 2026-11-06. */
const rows = {
  nullifier: {
    cost: 4350,
    behavior: "Unit Target",
    target_team: "Enemy",
    attrib: [{ key: "bonus_damage" }, { key: "bonus_armor" }],
    abilities: [ability("active", "Dispels the target and applies a debuff for 4 seconds. Continuously dispels and slows the target.\n\nDispel Type: Basic Dispel")],
  },
  cyclone: {
    cost: 2625,
    behavior: "Unit Target",
    target_team: [],
    attrib: [{ key: "bonus_intellect" }],
    abilities: [ability("active", "Sweeps a target unit up into a cyclone, making them invulnerable for 2.5 seconds. Cyclone can only be cast on enemy units or yourself.\n\nDispel Type: Basic Dispel")],
  },
  guardian_greaves: {
    cost: 4950,
    behavior: ["Instant Cast", "No Target"],
    attrib: [{ key: "bonus_armor" }],
    abilities: [
      ability("active", "Restores 325 health and 200 mana to nearby allies, and removes most negative effects from the caster.  Radius: 1200 Dispel Type: Basic Dispel"),
      ability("passive", "Grants 2.5 health regeneration and 1.5 mana regeneration to allied units."),
    ],
  },
  disperser: {
    cost: 6100,
    behavior: ["Unit Target", "AOE"],
    target_team: "Both",
    attrib: [{ key: "bonus_agility" }],
    abilities: [ability("active", "Dispels both the wearer and the target. Enemy targets are slowed for 5 seconds.\n\nDispel Type: Basic Dispel")],
  },
  aeon_disk: {
    cost: 3000,
    behavior: null,
    attrib: [{ key: "bonus_health" }],
    abilities: [ability("passive", "When you take damage and your health falls below 70%, a strong dispel is applied.\n\nDispel Type: Strong Dispel")],
  },
  greater_crit: { cost: 5100, attrib: [{ key: "bonus_damage" }, { key: "crit_chance" }], abilities: [ability("passive", "Grants a chance to deal critical damage.")] },
  skadi: { cost: 5300, attrib: [{ key: "bonus_all_stats" }], abilities: [ability("passive", "Attacks slow and reduce healing.")] },
  recipe_nullifier: { cost: 0, abilities: [ability("active", "Dispel Type: Basic Dispel")] },
  // A neutral item: no shop cost.
  witchbane: { cost: 0, attrib: [{ key: "bonus_damage" }], abilities: [ability("active", "Dispel Type: Basic Dispel")] },
};

describe("toItemFacts", () => {
  it("reads each item's dispel, who it reaches and whether it adds to attacks", () => {
    expect(toItemFacts(rows)).toEqual({
      nullifier: { dispel: "basic", reaches: ["enemy"], repeats: true, attack: true },
      cyclone: { dispel: "basic", reaches: ["enemy", "self"], invulnerableTarget: true },
      guardian_greaves: { dispel: "basic", reaches: ["self"] },
      disperser: { dispel: "basic", reaches: ["enemy", "self", "ally"] },
      aeon_disk: { dispel: "strong", reaches: ["self"], passive: true },
      greater_crit: { attack: true },
    });
  });

  it("throws on constants that are not an object", () => {
    expect(() => toItemFacts([])).toThrow();
  });
});

describe("item facts", () => {
  it("has the 10 shop items that dispel today, and no neutral item", () => {
    const dispel = Object.entries(ITEM_FACTS).filter(([, f]) => f.dispel).map(([k]) => k).sort();
    expect(dispel).toEqual(["aeon_disk", "black_king_bar", "cyclone", "disperser", "guardian_greaves", "lotus_orb", "manta", "nullifier", "satanic", "wind_waker"]);
  });

  it("finds Nullifier and Disperser as the dispels you aim at an enemy and can still hit", () => {
    const enemy = Object.keys(ITEM_FACTS).filter(dispelsEnemy).sort();
    expect(enemy).toEqual(["disperser", "nullifier"]);
    expect(itemFact("nullifier").repeats).toBe(true);
    expect(itemFact("disperser").repeats).toBeUndefined();
  });

  it("marks right-click items and leaves out stat-only ones", () => {
    for (const key of ["bfury", "butterfly", "monkey_king_bar", "greater_crit", "desolator"]) expect(itemFact(key).attack, key).toBe(true);
    for (const key of ["skadi", "disperser", "kaya", "blink"]) expect(itemFact(key).attack, key).toBeUndefined();
  });
});
