import { describe, expect, it } from "vitest";
import type { ItemBuild } from "../src/engine/item-build";
import { itemEffect, withEffects } from "../src/engine/item-effects";
import type { HeroInfo, ItemInfo } from "../src/engine/types";

const hero = (id: number, name: string, roles: string[]): HeroInfo => ({ id, name, roles, attackType: "Melee", primaryAttr: "str" });
const ENIGMA = hero(33, "Enigma", ["Disabler", "Initiator", "Pusher"]);
const LION = hero(26, "Lion", ["Support", "Disabler", "Nuker"]);
const SHAKER = hero(7, "Earthshaker", ["Support", "Initiator", "Disabler"]);
const AXE = hero(2, "Axe", ["Initiator", "Durable", "Disabler"]);
const PL = hero(12, "Phantom Lancer", ["Carry", "Escape", "Pusher"]);
const ZEUS = hero(22, "Zeus", ["Nuker", "Carry"]);

describe("itemEffect", () => {
  it("names the stuns Black King Bar stops, and the ultimate that still goes through it", () => {
    expect(itemEffect("black_king_bar", [LION, ENIGMA, PL])).toEqual({
      line: "Stops their stuns: Lion and Enigma. Black Hole still goes through it.",
      against: [26, 33],
    });
  });

  it("names three heroes at most", () => {
    expect(itemEffect("black_king_bar", [LION, SHAKER, AXE, ENIGMA])?.against).toEqual([26, 7, 2]);
  });

  it("names the illusion hero Radiance burns", () => {
    expect(itemEffect("radiance", [ZEUS, PL])).toEqual({ line: "Burns down Phantom Lancer's illusions.", against: [12] });
  });

  it("falls back to the plain effect when no enemy brings the threat", () => {
    expect(itemEffect("radiance", [ZEUS, LION])).toEqual({ line: "Burns everything near you, and 25% evasion.", against: [] });
    expect(itemEffect("blink", [LION])).toEqual({ line: "Start fights from 1,200 range.", against: [] });
  });

  it("gives no line for an item missing from the table", () => {
    expect(itemEffect("tango", [LION])).toBeNull();
  });
});

describe("withEffects", () => {
  const item = (key: string, name: string, cost: number): ItemInfo => ({ key, name, cost, img: "", components: [] });
  const items: Record<string, ItemInfo> = { 116: item("black_king_bar", "Black King Bar", 4050), 44: item("tango", "Tango", 90) };
  const build: ItemBuild = {
    timings: "rank",
    start: [{ itemId: 44, name: "Tango", img: "", minute: 0, phase: "start" }],
    lane: [],
    core: [
      { itemId: 116, name: "Black King Bar", img: "", minute: 22, phase: "first" },
      { itemId: 44, name: "Tango", img: "", minute: 5, phase: "lane" },
    ],
    situational: [],
  };

  it("adds the line to core items only, and leaves items with no line as they are", () => {
    const out = withEffects(build, [LION], items);
    expect(out.core[0]).toMatchObject({ effect: "Stops their stuns: Lion.", effectAgainst: [26] });
    expect(out.core[1]).not.toHaveProperty("effect");
    expect(out.start[0]).not.toHaveProperty("effect");
  });
});
