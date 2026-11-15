import { describe, expect, it } from "vitest";
import { fetchItems, itemsDue, toItemAbilities, toItemPhases, toItemStats, toItems, toSpellText } from "../src/data/items";
import type { Snapshot } from "../src/engine/types";

const constants = {
  blades_of_attack: { id: 2, dname: "Blades of Attack", cost: 450, img: "/items/blades_of_attack.png?t=1", components: null },
  ogre_axe: { id: 21, dname: "Ogre Axe", cost: 1000, img: "/items/ogre_axe.png?t=1", components: null },
  black_king_bar: { id: 116, dname: "Black King Bar", cost: 4050, img: "/items/black_king_bar.png?t=1", components: ["ogre_axe", "mithril_hammer"] },
  recipe_black_king_bar: { id: 115, dname: "Black King Bar Recipe", cost: 1375, img: "/items/recipe.png" },
  bracer: {
    id: 73,
    dname: "Bracer",
    cost: 505,
    img: "/items/bracer.png",
    components: ["blades_of_attack"],
    attrib: [{ key: "bonus_health", display: "+ {value} Health", value: "50" }],
    abilities: [{ type: "passive", title: "Sturdy" }],
    cd: 10,
    mc: false,
  },
  wand: { id: 36, dname: "Magic Wand", cost: 450, img: "/items/wand.png", abilities: [{ type: "active", title: "Energy Charge" }], cd: 15, mc: false },
  aegis: { id: 117, dname: "Aegis of the Immortal", cost: 0, img: "/items/aegis.png" },
};

describe("toItems", () => {
  it("keeps shop items by id with their components and drops recipes and free items", () => {
    const items = toItems(constants);
    expect(Object.keys(items).sort()).toEqual(["116", "2", "21", "36", "73"]);
    expect(items[36]).toMatchObject({ abilities: [{ kind: "active", name: "Energy Charge" }], cooldown: 15 });
    expect(items[36]!.manaCost).toBeUndefined();
    // Mithril Hammer is not in the list, so it is left out of the components.
    expect(items[116]).toEqual({ key: "black_king_bar", name: "Black King Bar", cost: 4050, img: "/items/black_king_bar.png", components: [21] });
    expect(items[2]!.components).toEqual([]);
    expect(items[73]).toEqual({
      key: "bracer",
      name: "Bracer",
      cost: 505,
      img: "/items/bracer.png",
      components: [2],
      stats: [{ value: "+50", label: "Health" }],
      abilities: [{ kind: "passive", name: "Sturdy" }],
    });
  });

  it("builds each Dagon level from the one below, which OpenDota does not list", () => {
    const items = toItems({
      ...constants,
      dagon: { id: 104, dname: "Dagon", cost: 3050, img: "", components: ["ogre_axe"] },
      dagon_2: { id: 201, dname: "Dagon", cost: 4200, img: "", components: null },
      dagon_3: { id: 202, dname: "Dagon", cost: 5350, img: "", components: null },
      // A level whose lower level is missing keeps no parts, and listed parts are kept as they are.
      travel_boots_2: { id: 220, dname: "Boots of Travel 2", cost: 4500, img: "", components: ["blades_of_attack"] },
      diffusal_blade_2: { id: 196, dname: "Diffusal Blade", cost: 3850, img: "", components: null },
      // Not an upgrade: the "level below" costs more.
      ogre_axe_2: { id: 900, dname: "Axe", cost: 500, img: "", components: null },
    });
    expect(items[104]!.components).toEqual([21]);
    expect(items[201]!.components).toEqual([104]);
    expect(items[202]!.components).toEqual([201]);
    expect(items[220]!.components).toEqual([2]);
    expect(items[196]!.components).toEqual([]);
    expect(items[900]!.components).toEqual([]);
  });
});

describe("toItemStats", () => {
  it("keeps the shop's bonus lines as amount and label, without zero amounts or other lines", () => {
    const attrib = [
      { key: "bonus_strength", display: "+ {value} Strength", value: "5" },
      { key: "bonus_damage", value: "0" },
      { key: "bonus_health_regen", display: "+ {value} Health Regeneration", value: "0.75" },
      { key: "bonus_health", display: "+ {value} Health", value: "50" },
      { key: "skadi_health", display: "+ {value} Health", value: "0" },
      { key: "bonus_magic", display: "+ {value}% Magic Resistance", value: "20" },
      { key: "melee", display: "+ {value} Damage (MELEE)", value: "8" },
      { key: "cooldown", display: "COOLDOWN: {value}", value: "105" },
      { key: "broken", display: "+ {value} Armor", value: "a lot" },
      "not a row",
    ];
    expect(toItemStats("bracer", attrib)).toEqual([
      { value: "+5", label: "Strength" },
      { value: "+0.75", label: "Health Regeneration" },
      { value: "+50", label: "Health" },
      { value: "+20%", label: "Magic Resistance" },
      { value: "+8", label: "Damage (Melee)" },
    ]);
    expect(toItemStats("bracer", null)).toEqual([]);
  });

  it("takes the amount of the item's own level", () => {
    const attrib = [{ key: "bonus_health", display: "+ {value} Health", value: "200 / 210 / 220" }];
    expect(toItemStats("dagon", attrib)).toEqual([{ value: "+200", label: "Health" }]);
    expect(toItemStats("dagon_2", attrib)).toEqual([{ value: "+210", label: "Health" }]);
    expect(toItemStats("dagon_5", attrib)).toEqual([{ value: "+220", label: "Health" }]);
  });
});

describe("toSpellText", () => {
  it("splits the tooltip into its text and its number lines", () => {
    expect(
      toSpellText("Applies a basic dispel. Grants 60% magic resistance. \n\nIllusions take 300% damage. \n\nDuration: 9s \nDispel Type: Basic Dispel"),
    ).toEqual({
      text: "Applies a basic dispel. Grants 60% magic resistance. Illusions take 300% damage.",
      facts: [
        { label: "Duration", value: "9s" },
        { label: "Dispel Type", value: "Basic Dispel" },
      ],
    });
    // A sentence with a colon in it is text, not a number line.
    expect(toSpellText("Note: when active, Unholy Strength grants +35 damage, +25 strength and +4 armor, but drains health.")).toEqual({
      text: "Note: when active, Unholy Strength grants +35 damage, +25 strength and +4 armor, but drains health.",
    });
    expect(toSpellText(undefined)).toEqual({});
  });
});

describe("toItemAbilities", () => {
  it("keeps the item's spells as active or passive, not Aghanim's upgrade lines", () => {
    expect(
      toItemAbilities([
        { type: "active", title: "Avatar", description: "Grants magic resistance.\n\nDuration: 9s" },
        { type: "toggle", title: "Unholy Strength" },
        { type: "use", title: "Devour" },
        { type: "passive", title: "Damage Block" },
        { type: "upgrade", title: "Aghanim's Scepter" },
        { type: "active" },
      ]),
    ).toEqual([
      { kind: "active", name: "Avatar", text: "Grants magic resistance.", facts: [{ label: "Duration", value: "9s" }] },
      { kind: "active", name: "Unholy Strength" },
      { kind: "active", name: "Devour" },
      { kind: "passive", name: "Damage Block" },
    ]);
    expect(toItemAbilities(undefined)).toEqual([]);
  });
});

describe("toItemPhases", () => {
  it("keeps the most bought known items of each phase", () => {
    const items = toItems(constants);
    const phases = toItemPhases(
      { start_game_items: { 2: 5, 999: 50 }, mid_game_items: { 116: 40, 21: 12, 2: 0 } },
      items,
    );
    expect(phases).toEqual({ start: { 2: 5 }, early: {}, mid: { 116: 40, 21: 12 }, late: {} });
  });
});

describe("itemsDue", () => {
  const base: Snapshot = { generatedAt: "", heroes: {}, bracketStats: {}, matchups: {}, synergy: {}, laneRoles: {} };

  it("is due without item data and after a day", () => {
    const now = new Date("2026-10-26T12:00:00Z");
    expect(itemsDue(base, now)).toBe(true);
    const fresh = { ...base, items: {}, itemBuilds: {}, itemsAt: "2026-10-26T00:00:00Z" };
    expect(itemsDue(fresh, now)).toBe(false);
    expect(itemsDue({ ...fresh, itemsAt: "2026-10-25T11:00:00Z" }, now)).toBe(true);
  });
});

describe("fetchItems", () => {
  it("downloads the item list and one build per hero", async () => {
    const snapshot: Snapshot = {
      generatedAt: "",
      heroes: { 42: { id: 42, name: "Wraith King", roles: [], attackType: "Melee", primaryAttr: "str" } },
      bracketStats: {},
      matchups: {},
      synergy: {},
      laneRoles: {},
    };
    const paths: string[] = [];
    const get = async <T,>(path: string): Promise<T> => {
      paths.push(path);
      return (path === "/constants/items" ? constants : { late_game_items: { 116: 3 } }) as T;
    };
    await fetchItems(snapshot, get, new Date("2026-10-26T12:00:00Z"));
    expect(paths).toEqual(["/constants/items", "/heroes/42/itemPopularity"]);
    expect(snapshot.itemBuilds?.[42]?.late).toEqual({ 116: 3 });
    expect(snapshot.itemsAt).toBe("2026-10-26T12:00:00.000Z");
  });
});
