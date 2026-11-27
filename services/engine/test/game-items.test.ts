import { describe, expect, it } from "vitest";
import { applyGameItems, atLevel, fetchGameItems, fillText, gameItems, plainText } from "../src/data/game-items";
import { parseKV } from "../src/data/talent-texts";
import type { ItemInfo } from "../src/engine/types";

const ITEMS = parseKV(`"DOTAAbilities" {
  "item_shadow_amulet" { "ItemCost" "900" }
  "item_shawl" { "ItemCost" "450" "AbilityValues" { "bonus_magical_armor" "10" } }
  "item_recipe_glimmer_cape" { "ItemCost" "800" "ItemResult" "item_glimmer_cape" "ItemRequirements" { "01" "item_shadow_amulet;item_shawl" } }
  "item_glimmer_cape" {
    "AbilityCooldown" "15" "AbilityManaCost" "125"
    "AbilityValues" { "bonus_magical_armor" "20" "barrier_block" { "value" "375" } "duration" "5.0" }
  }
  "item_skadi" { "ItemCost" "5300" "AbilityValues" { "bonus_all_stats" "32" "cold_slow_melee" "-20" "bonus_health" "0" } }
  "item_kaya" { "ItemCost" "2100" "AbilityValues" { "spell_amp" "6" } }
  "item_dagon" { "ItemCost" "2850" "ItemBaseLevel" "1" "AbilityCooldown" "27 24 21" "AbilityValues" { "damage" "400 500 600" } }
  "item_dagon_3" { "ItemCost" "5200" "ItemBaseLevel" "3" "AbilityCooldown" "27 24 21" "AbilityValues" { "damage" "400 500 600" } }
  "item_soul_ring" { "ItemCost" "805" "AbilityHealthCost" "170" }
  "item_broken" { "ItemCost" "1000" "AbilityValues" { "x" "1" } }
  "item_helm_of_the_overlord" { "ItemCost" "6000" "IsObsolete" "1" }
  "item_new_thing" { "ItemCost" "1500" "AbilityValues" { "bonus_armor" "4" } }
  "item_neutral_thing" { "ItemCost" "0" "ItemPurchasable" "0" }
}`);
const IDS = parseKV(`"DOTAAbilityIDs" { "ItemAbilities" { "Locked" {
  "item_shadow_amulet" "215" "item_shawl" "1848" "item_glimmer_cape" "254" "item_recipe_glimmer_cape" "253" "item_skadi" "160"
  "item_kaya" "259" "item_dagon" "104" "item_dagon_3" "202" "item_soul_ring" "178" "item_broken" "999" "item_helm_of_the_overlord" "635"
  "item_new_thing" "1999" "item_neutral_thing" "1998"
} } }`);
const TIPS = parseKV(`"lang" { "Tokens" {
  "dota_ability_variable_all" "All Attributes"
  "dota_ability_variable_spell_resist" "Magic Resistance"
  "dota_ability_variable_armor" "Armor"
  "DOTA_Tooltip_Ability_item_shawl" "Shawl"
  "DOTA_Tooltip_ability_item_shawl_bonus_magical_armor" "%+$spell_resist"
  "DOTA_Tooltip_ability_item_glimmer_cape_bonus_magical_armor" "%+$spell_resist"
  "DOTA_Tooltip_ability_item_glimmer_cape_Description" "<h1>Active: Glimmer</h1> Absorbs up to %barrier_block% damage for %duration% seconds.<br><br>Can be cast while channeling."
  "DOTA_Tooltip_ability_item_skadi_bonus_all_stats" "+$all"
  "DOTA_Tooltip_ability_item_skadi_bonus_health" "+$health"
  "DOTA_Tooltip_ability_item_skadi_Description" "<h1>Passive: Cold Attack</h1> Attacks lower movement by %cold_slow_melee%%%."
  "DOTA_Tooltip_ability_item_kaya_spell_amp" "%+Spell Amplification"
  "DOTA_Tooltip_ability_item_dagon_3_Description" "<h1>Active: Energy Burst</h1> Burst.<br><br>Damage: %damage%"
  "DOTA_Tooltip_ability_item_soul_ring_Description" "<h1>Active: Sacrifice</h1> Consume %abilityhealthcost% health."
  "DOTA_Tooltip_ability_item_broken_Description" "<h1>Active: Broken</h1> Deals %missing% damage."
  "DOTA_Tooltip_Ability_item_new_thing" "New Thing"
  "DOTA_Tooltip_ability_item_new_thing_bonus_armor" "+$armor"
} }`);

const item = (key: string, name: string, cost: number, extra: Partial<ItemInfo> = {}): ItemInfo => ({ key, name, cost, img: `/${key}.png`, components: [], ...extra });

describe("game file helpers", () => {
  it("reads the value of the item's level", () => {
    expect(atLevel("27 24 21 18 15", 3)).toBe(21);
    expect(atLevel("27 24", 5)).toBe(24);
    expect(atLevel("=12%", 1)).toBe(12);
    expect(atLevel("fast", 1)).toBeNull();
    expect(atLevel(undefined, 1)).toBeNull();
  });

  it("takes markup out, keeping what tags wrap and breaking lines at <br>", () => {
    expect(plainText('Dispel: <span class="x">Basic</span><br>Next')).toBe("Dispel: Basic\nNext");
    expect(plainText("Cut <span")).toBe("Cut ");
  });

  it("fills in values and refuses a text with one it can't fill", () => {
    const values = new Map([["damage", "400 500 600"]]);
    expect(fillText("Deals %damage% damage, %%", values, {}, 2)).toBe("Deals 500 damage, %");
    expect(fillText("Costs %AbilityManaCost%", values, { AbilityManaCost: "120 140" }, 2)).toBe("Costs 140");
    expect(fillText("Deals %missing%", values, {}, 1)).toBeNull();
  });
});

describe("gameItems", () => {
  const game = gameItems(ITEMS, IDS, TIPS);

  it("reads gold, parts, bonuses, spells, cooldown and mana of a built item", () => {
    expect(game.get("glimmer_cape")).toEqual({
      id: 254,
      key: "glimmer_cape",
      cost: 2150,
      components: ["shadow_amulet", "shawl"],
      stats: [{ value: "+20%", label: "Magic Resistance" }],
      abilities: [{ kind: "active", name: "Glimmer", text: "Absorbs up to 375 damage for 5 seconds. Can be cast while channeling." }],
      cooldown: 15,
      manaCost: 125,
      purchasable: true,
    });
  });

  it("leaves out zero bonuses and reads spelled-out bonus lines", () => {
    expect(game.get("skadi")!.stats).toEqual([{ value: "+32", label: "All Attributes" }]);
    expect(game.get("skadi")!.abilities).toEqual([{ kind: "passive", name: "Cold Attack", text: "Attacks lower movement by -20%." }]);
    expect(game.get("kaya")!.stats).toEqual([{ value: "+6%", label: "Spell Amplification" }]);
  });

  it("reads a level item's numbers at its level and the ability's own fields", () => {
    const dagon = game.get("dagon_3")!;
    expect(dagon.cooldown).toBe(21);
    expect(dagon.abilities![0]!.facts).toEqual([{ label: "Damage", value: "600" }]);
    expect(game.get("soul_ring")!.abilities![0]!.text).toBe("Consume 170 health.");
  });

  it("marks a spell text it can't fill, leaves out removed items and knows what the shop doesn't sell", () => {
    expect(game.get("broken")!.abilities).toBeNull();
    expect(game.has("helm_of_the_overlord")).toBe(false);
    expect(game.has("recipe_glimmer_cape")).toBe(false);
    expect(game.get("neutral_thing")!.purchasable).toBe(false);
  });
});

describe("applyGameItems", () => {
  it("lays the game's numbers over OpenDota's, keeping names and art, and says what changed", () => {
    const items: Record<string, ItemInfo> = {
      215: item("shadow_amulet", "Shadow Amulet", 900),
      1848: item("shawl", "Shawl", 450, { stats: [{ value: "+10%", label: "Magic Resistance" }] }),
      254: item("glimmer_cape", "Glimmer Cape", 2150, { components: [215, 1848] }),
      160: item("skadi", "Eye of Skadi", 5300, { stats: [{ value: "+35", label: "All Attributes" }], abilities: [{ kind: "passive", name: "Cold Attack", text: "Old." }] }),
      999: item("broken", "Broken", 1000, { abilities: [{ kind: "active", name: "Broken", text: "OpenDota's text." }] }),
    };
    const { changed, added } = applyGameItems(items, gameItems(ITEMS, IDS, TIPS));
    expect(items[160]!.stats).toEqual([{ value: "+32", label: "All Attributes" }]);
    expect(items[160]!.name).toBe("Eye of Skadi");
    expect(items[254]!.cooldown).toBe(15);
    // A text the files can't fill keeps OpenDota's.
    expect(items[999]!.abilities![0]!.text).toBe("OpenDota's text.");
    expect(changed).toEqual([
      { name: "Glimmer Cape", fields: ["stats", "abilities", "cooldown", "manaCost"] },
      { name: "Eye of Skadi", fields: ["stats", "abilities"] },
    ]);
    // Sold by the shop, named in the game, missing from OpenDota: added with the usual picture path. Items with no
    // name in the tooltips (Kaya, Dagon here) are not.
    expect(added).toEqual(["New Thing"]);
    expect(items[1999]).toEqual({ key: "new_thing", name: "New Thing", cost: 1500, img: "/apps/dota2/images/dota_react/items/new_thing.png", components: [], stats: [{ value: "+4", label: "Armor" }] });
    expect(items[1998]).toBeUndefined();
  });

  it("keeps a level item's part when no recipe in the files makes it", () => {
    const items: Record<string, ItemInfo> = { 104: item("dagon", "Dagon", 2850), 202: item("dagon_3", "Dagon", 5200, { components: [104] }) };
    applyGameItems(items, gameItems(ITEMS, IDS, TIPS));
    expect(items[202]!.components).toEqual([104]);
    expect(items[202]!.cooldown).toBe(21);
  });
});

describe("fetchGameItems", () => {
  it("throws when the files give too few shop items", async () => {
    await expect(fetchGameItems(async (url) => (url.includes("items.txt") ? '"DOTAAbilities" {}' : '"x" {}'))).rejects.toThrow("only 0 shop items");
  });
});
