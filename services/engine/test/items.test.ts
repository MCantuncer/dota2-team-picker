import { describe, expect, it } from "vitest";
import { fetchItems, itemsDue, toItemPhases, toItems } from "../src/data/items";
import type { Snapshot } from "../src/engine/types";

const constants = {
  blades_of_attack: { id: 2, dname: "Blades of Attack", cost: 450, img: "/items/blades_of_attack.png?t=1", components: null },
  ogre_axe: { id: 21, dname: "Ogre Axe", cost: 1000, img: "/items/ogre_axe.png?t=1", components: null },
  black_king_bar: { id: 116, dname: "Black King Bar", cost: 4050, img: "/items/black_king_bar.png?t=1", components: ["ogre_axe", "mithril_hammer"] },
  recipe_black_king_bar: { id: 115, dname: "Black King Bar Recipe", cost: 1375, img: "/items/recipe.png" },
  aegis: { id: 117, dname: "Aegis of the Immortal", cost: 0, img: "/items/aegis.png" },
};

describe("toItems", () => {
  it("keeps shop items by id with their components and drops recipes and free items", () => {
    const items = toItems(constants);
    expect(Object.keys(items).sort()).toEqual(["116", "2", "21"]);
    // Mithril Hammer is not in the list, so it is left out of the components.
    expect(items[116]).toEqual({ key: "black_king_bar", name: "Black King Bar", cost: 4050, img: "/items/black_king_bar.png", components: [21] });
    expect(items[2]!.components).toEqual([]);
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
