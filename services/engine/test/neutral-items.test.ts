import { describe, expect, it } from "vitest";
import { buildNeutralPool, neutralStats, neutralsDue, parseKeyValues, toNeutralTiers } from "../src/data/neutral-items";

/** A cut-down neutral_items.txt in the game's layout, with a comment and a stray brace. */
const FILE = `"neutral_items"
{
	"madstone_limits" { "madstone_no_limit_time" "65:00" }
	"neutral_tiers"
	{
		"2" // the second tier first, the file order is not the tier order
		{
			"start_time"			"15:00"
			"trinket_options"		"5"
			"craft_cost"			"10"
			"item_pools"
			{
				"pool_a" { "options" "1" "items" { "item_safety_bubble" "1" "item_imp_claw" "1" } }
			}
			"enhancements"
			{
				"global" { "item_enhancement_quickened" "2" }
				"strength" { "item_enhancement_brawny" "2" }
			}
		}
		"1"
		{
			"start_time"			"0:00"
			"trinket_options"		"5"
			"craft_cost"			"6"
			"item_pools"
			{
				"pool_a" { "options" "1" "items" { "item_chipped_vest" "1" "item_not_in_constants" "1" } }
				"pool_b" { "options" "1" "items" { "item_divine_regalia" "1" } }
			}
			"enhancements"
			{
				"global" { "item_enhancement_quickened" "1" }
				"strength" { "item_enhancement_brawny" "1" }
			}
		}
	}
}
}`;

const rows = {
  safety_bubble: {
    id: 1157,
    dname: "Safety Bubble",
    cost: 0,
    img: "/items/safety_bubble.png?t=1",
    abilities: [{ type: "passive", title: "Bubbled Up", description: "Equipped Hero has a 125 HP Barrier against enemy damage." }],
    cd: false,
  },
  imp_claw: { id: 334, dname: "Imp Claw", cost: 0, img: "/items/imp_claw.png", abilities: [{ type: "passive", title: "Critical Strike" }], cd: 7 },
  chipped_vest: { id: 1573, dname: "Chipped Vest", cost: 0, img: "/items/chipped_vest.png", attrib: [{ key: "hp", display: "+ {value} Health Regeneration", value: "1.5" }] },
  divine_regalia: { id: 1644, dname: "Divine Regalia", cost: 0, img: "/items/divine_regalia.png" },
  divine_regalia_broken: { id: 1645, dname: "Disgraced Regalia", cost: 0, img: "/items/divine_regalia_broken.png" },
  enhancement_quickened: {
    id: 1577,
    dname: "Quickened",
    cost: 0,
    img: "/items/enhancement_quickened.png",
    attrib: [
      { key: "movement_speed", display: "+ {value} Movement Speed", value: "14 / 22 / 30" },
      { key: "max_mana", display: "+ {value} Mana", value: "0 / 130 / 200" },
    ],
  },
  enhancement_brawny: { id: 1585, dname: "Brawny", cost: 0, img: "/items/enhancement_brawny.png", attrib: [{ key: "h", display: "+ {value} Health", value: "110 / 170" }] },
};

describe("parseKeyValues", () => {
  it("reads nested blocks, values and skips comments", () => {
    const kv = parseKeyValues(`"a" { "b" "1" // note "x" "y"
      "c" { "d" "two words" } }`);
    expect(kv).toEqual({ a: { b: "1", c: { d: "two words" } } });
  });
});

describe("toNeutralTiers", () => {
  it("orders tiers, maps items to ids, keeps enchantment levels and names missing items", () => {
    const { tiers, missing } = toNeutralTiers(parseKeyValues(FILE), rows);
    expect(tiers.map((t) => [t.tier, t.minute, t.craftCost, t.options])).toEqual([
      [1, 0, 6, 5],
      [2, 15, 10, 5],
    ]);
    expect(tiers[0]!.pools).toEqual([[1573], [1644]]);
    expect(tiers[1]!.enchants.global).toEqual([[1577, 2]]);
    expect(tiers[1]!.enchants.strength).toEqual([[1585, 2]]);
    expect(tiers[1]!.enchants.agility).toEqual([]);
    expect(missing).toEqual(["not_in_constants"]);
  });

  it("throws on a file without tiers", () => {
    expect(() => toNeutralTiers(parseKeyValues(`"neutral_items" { }`), rows)).toThrow("no neutral_tiers");
  });
});

describe("neutralStats", () => {
  it("takes the level's amount, skips zeros and keeps a cost's minus", () => {
    const attrib = [
      { display: "+ {value} Mana", value: "0 / 130 / 200" },
      { display: "- {value} Armor", value: "-4 / -6 / -8" },
      { display: "- {value}% Max Mana", value: "20" },
      { key: "bonus_xpm", value: "1000" },
    ];
    expect(neutralStats(attrib, 1)).toEqual([
      { value: "-4", label: "Armor" },
      { value: "-20%", label: "Max Mana" },
    ]);
    expect(neutralStats(attrib, 3)[0]).toEqual({ value: "+200", label: "Mana" });
  });
});

describe("buildNeutralPool", () => {
  const now = new Date("2026-11-25T09:00:00Z");

  it("throws on a cut-short file so the last pool stays", () => {
    expect(() => buildNeutralPool(FILE, rows, now)).toThrow("only 2 tiers");
  });

  it("builds tooltips for artifacts, their used-up forms and enchantments by level", () => {
    // Pad the file to a full pool: copy tier 1 as tiers 3 and 4 with enough artifacts.
    const many = Array.from({ length: 20 }, (_, i) => `"item_imp_claw_${i}" "1"`).join(" ");
    const padded = FILE.replace(`"1"\n\t\t{`, `"3" { "start_time" "30:00" "item_pools" { "p" { "items" { ${many} } } } }\n\t\t"1"\n\t\t{`);
    const extra = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`imp_claw_${i}`, { id: 5000 + i, dname: `Claw ${i}`, cost: 0, img: "/c.png" }]));
    const { pool } = buildNeutralPool(padded, { ...rows, ...extra }, now);
    expect(pool.at).toBe(now.toISOString());
    expect(pool.items[1157]).toEqual({
      key: "safety_bubble",
      name: "Safety Bubble",
      img: "/items/safety_bubble.png",
      kind: "artifact",
      tier: 2,
      abilities: [{ kind: "passive", name: "Bubbled Up", text: "Equipped Hero has a 125 HP Barrier against enemy damage." }],
    });
    expect(pool.items[334]?.cooldown).toBe(7);
    expect(pool.items[1573]?.stats).toEqual([{ value: "+1.5", label: "Health Regeneration" }]);
    expect(pool.items[1645]).toMatchObject({ name: "Disgraced Regalia", tier: 1, brokenOf: 1644 });
    expect(pool.items[1577]).toMatchObject({
      kind: "enchantment",
      levels: [[{ value: "+14", label: "Movement Speed" }], [{ value: "+22", label: "Movement Speed" }, { value: "+130", label: "Mana" }]],
    });
    expect(pool.items[1577]?.tier).toBeUndefined();
  });
});

describe("neutralsDue", () => {
  it("is due with no pool or a day-old one", () => {
    const now = new Date("2026-11-25T09:00:00Z");
    expect(neutralsDue({}, now)).toBe(true);
    expect(neutralsDue({ neutrals: { at: "2026-11-24T08:00:00Z", tiers: [], items: {} } }, now)).toBe(true);
    expect(neutralsDue({ neutrals: { at: "2026-11-25T01:00:00Z", tiers: [], items: {} } }, now)).toBe(false);
  });
});
