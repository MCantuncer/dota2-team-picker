import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  STARTS_PER_QUERY,
  fetchItemStarts,
  itemStartsQuery,
  startRequests,
  toItemStart,
  type BootRow,
  type StartRow,
} from "../src/data/item-starts";
import type { ItemInfo, Snapshot } from "../src/engine/types";

/** Real STRATZ rows for Juggernaut pos 1, every rank (Nov 2026), start rows trimmed to eight items. */
const JUGGERNAUT: { starts: StartRow[]; boots: BootRow[] } = JSON.parse(
  readFileSync(new URL("./fixtures/stratz-juggernaut-pos1-start-boots.json", import.meta.url), "utf8"),
);

const item = (key: string, name: string, cost: number): ItemInfo => ({ key, name, cost, img: "", components: [] });
const ITEMS: Record<string, ItemInfo> = {
  11: item("quelling_blade", "Quelling Blade", 100),
  14: item("slippers", "Slippers of Agility", 140),
  16: item("branches", "Iron Branch", 55),
  20: item("circlet", "Circlet", 155),
  29: item("boots", "Boots of Speed", 500),
  34: item("magic_stick", "Magic Stick", 200),
  36: item("magic_wand", "Magic Wand", 460),
  44: item("tango", "Tango", 90),
  48: item("travel_boots", "Boots of Travel", 2500),
  50: item("phase_boots", "Phase Boots", 1450),
  63: item("power_treads", "Power Treads", 1400),
  237: item("faerie_fire", "Faerie Fire", 65),
};

describe("startRequests", () => {
  it("asks once for each hero's two main positions", () => {
    expect(startRequests({ 1: [900, 30, 0, 0, 0] })).toEqual([
      { heroId: 1, position: 1 },
      { heroId: 1, position: 2 },
    ]);
  });
});

describe("itemStartsQuery", () => {
  it("asks for start items and boots with an alias pair per hero", () => {
    const query = itemStartsQuery([{ heroId: 8, position: 1 }]);
    expect(query).toContain("a0: itemStartingPurchase(heroId: 8, positionIds: [POSITION_1])");
    expect(query).toContain("b0: itemBootPurchase(heroId: 8, positionIds: [POSITION_1])");
  });

  it("refuses an empty or too large batch", () => {
    expect(() => itemStartsQuery([])).toThrow();
    expect(() => itemStartsQuery(Array.from({ length: STARTS_PER_QUERY + 1 }, () => ({ heroId: 1, position: 1 as const })))).toThrow();
  });
});

describe("toItemStart", () => {
  it("turns real STRATZ rows into the usual start and boots", () => {
    const start = toItemStart(JUGGERNAUT.starts, JUGGERNAUT.boots, ITEMS)!; // The fixture has rows.
    // Bought by at least 30% of players, most bought first, with copies half of them buy.
    expect(start.start.map(([id, count]) => [ITEMS[id]!.name, count])).toEqual([
      ["Quelling Blade", 1],
      ["Tango", 1],
      ["Iron Branch", 2],
      ["Magic Stick", 1],
      ["Faerie Fire", 1],
      ["Circlet", 1],
    ]);
    // Power Treads, with Phase Boots as the other choice; Boots of Speed and Travel are left out.
    expect(start.boots.map(([id, minute]) => [ITEMS[id]!.name, minute])).toEqual([
      ["Power Treads", 7],
      ["Phase Boots", 8],
    ]);
  });

  it("counts given copies with the bought ones", () => {
    // Half of Juggernauts hold a second Iron Branch, and most of those are marked as given.
    const branches = JUGGERNAUT.starts.filter((r) => r.itemId === 16 && r.instance === 1);
    expect(branches.some((r) => r.wasGiven)).toBe(true);
    const ownOnly = toItemStart(JUGGERNAUT.starts.filter((r) => !r.wasGiven), JUGGERNAUT.boots, ITEMS)!;
    expect(ownOnly.start.find(([id]) => id === 16)?.[1]).toBe(1);
  });

  it("is null without start rows", () => {
    expect(toItemStart([], JUGGERNAUT.boots, ITEMS)).toBeNull();
  });
});

describe("fetchItemStarts", () => {
  const snapshot = (): Snapshot => ({
    generatedAt: "",
    heroes: {},
    bracketStats: {},
    matchups: {},
    synergy: {},
    laneRoles: {},
    positions: { 8: [900, 0, 0, 0, 0] },
    items: ITEMS,
  });

  it("stores each hero's start by position", async () => {
    const data = snapshot();
    await fetchItemStarts(data, async () => ({ heroStats: { a0: JUGGERNAUT.starts, b0: JUGGERNAUT.boots } }));
    expect(data.itemStarts![8]![1]!.boots[0]![0]).toBe(63);
  });

  it("fails when STRATZ answers without heroStats", async () => {
    await expect(fetchItemStarts(snapshot(), async () => ({}))).rejects.toThrow("no heroStats");
  });
});
