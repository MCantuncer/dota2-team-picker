import { describe, expect, it } from "vitest";
import type { ItemBuild } from "../src/engine/item-build";
import { itemEffect, withEffects } from "../src/engine/item-effects";
import type { HeroInfo, ItemInfo } from "../src/engine/types";

const hero = (id: number, name: string, roles: string[]): HeroInfo => ({
  id,
  name,
  roles,
  attackType: "Melee",
  primaryAttr: "str",
});
const ENIGMA = hero(33, "Enigma", ["Disabler", "Initiator", "Pusher"]);
const LION = hero(26, "Lion", ["Support", "Disabler", "Nuker"]);
const SHAKER = hero(7, "Earthshaker", ["Support", "Initiator", "Disabler"]);
const AXE = hero(2, "Axe", ["Initiator", "Durable", "Disabler"]);
const PL = hero(12, "Phantom Lancer", ["Carry", "Escape", "Pusher"]);
const ZEUS = hero(22, "Zeus", ["Nuker", "Carry"]);

describe("itemEffect", () => {
  it("names the disables Black King Bar stops, and the ultimate that still goes through it", () => {
    expect(itemEffect("black_king_bar", [LION, ENIGMA, PL])).toEqual({
      line: "Stops disables from Lion. Black Hole still goes through it.",
      against: [26],
    });
  });

  it("names three heroes at most, and every disable that still goes through", () => {
    const LINA = hero(25, "Lina", ["Carry", "Support", "Nuker", "Disabler"]);
    const VOID = hero(41, "Faceless Void", ["Carry", "Initiator", "Disabler", "Escape", "Durable"]);
    expect(itemEffect("black_king_bar", [LION, SHAKER, AXE, LINA, ENIGMA, VOID])).toEqual({
      line: "Stops disables from Lion, Earthshaker and Lina. Berserker's Call, Black Hole and Chronosphere still go through it.",
      against: [26, 7, 25],
    });
  });

  it("says Black King Bar's plain line when every disable goes through it", () => {
    expect(itemEffect("black_king_bar", [AXE])?.line).toBe("Spell immunity for the big fights. Berserker's Call still goes through it.");
  });

  it("leaves out heroes whose disable may go through Black King Bar", () => {
    const NAGA = hero(89, "Naga Siren", ["Carry", "Support", "Pusher", "Disabler", "Initiator", "Escape"]);
    expect(itemEffect("black_king_bar", [NAGA, LION])?.line).toBe("Stops disables from Lion.");
  });

  it("warns that Pulverize goes through, and doesn't name Primal Beast as a hero it stops", () => {
    const PB = hero(137, "Primal Beast", ["Initiator", "Durable", "Disabler"]);
    expect(itemEffect("black_king_bar", [PB, LION])?.line).toBe("Stops disables from Lion. Pulverize still goes through it.");
  });

  it("still names Death Prophet, whose Silence it stops, and warns that Exorcism goes through", () => {
    const DP = hero(43, "Death Prophet", ["Carry", "Pusher", "Nuker", "Disabler"]);
    expect(itemEffect("black_king_bar", [DP, LION])).toEqual({
      line: "Stops disables from Death Prophet and Lion. Exorcism still goes through it.",
      against: [43, 26],
    });
  });

  it("names a list of heroes without a possessive", () => {
    const LINA = hero(25, "Lina", ["Carry", "Support", "Nuker", "Disabler"]);
    expect(itemEffect("pipe", [LION, LINA])?.line).toBe("Blocks magic burst from Lion and Lina for your team.");
  });

  it("names the illusion hero Radiance burns", () => {
    expect(itemEffect("radiance", [ZEUS, PL])).toEqual({
      line: "Burns down illusions from Phantom Lancer.",
      against: [12],
    });
  });

  it("falls back to the plain effect when no enemy brings the threat", () => {
    expect(itemEffect("radiance", [ZEUS, LION])).toEqual({
      line: "Burns everything near you, and 25% evasion.",
      against: [],
    });
    expect(itemEffect("blink", [LION])).toEqual({
      line: "Start fights from 1,200 range.",
      against: [],
    });
  });

  it("gives no line for an item missing from the table", () => {
    expect(itemEffect("tango", [LION])).toBeNull();
  });
});

describe("withEffects", () => {
  const item = (key: string, name: string, cost: number): ItemInfo => ({
    key,
    name,
    cost,
    img: "",
    components: [],
  });
  const items: Record<string, ItemInfo> = {
    116: item("black_king_bar", "Black King Bar", 4050),
    44: item("tango", "Tango", 90),
  };
  const build: ItemBuild = {
    timings: "rank",
    start: [{ itemId: 44, name: "Tango", img: "", minute: 0, phase: "start" }],
    lane: [],
    core: [
      {
        itemId: 116,
        name: "Black King Bar",
        img: "",
        minute: 22,
        phase: "first",
      },
      { itemId: 44, name: "Tango", img: "", minute: 5, phase: "lane" },
    ],
    situational: [],
  };

  it("adds the line to core items only, and leaves items with no line as they are", () => {
    const out = withEffects(build, [LION], items);
    expect(out.core[0]).toMatchObject({
      effect: "Stops disables from Lion.",
      effectAgainst: [26],
    });
    expect(out.core[1]).not.toHaveProperty("effect");
    expect(out.start[0]).not.toHaveProperty("effect");
  });

  it("gives a counter item its plain line, since its reason already names the enemies", () => {
    const counter = { ...build, core: [{ ...build.core[0]!, reason: "Against Lion" }] }; // build.core has two items.
    expect(withEffects(counter, [LION], items).core[0]).toMatchObject({ effect: "Spell immunity for the big fights.", effectAgainst: [] });
    // It still warns of a disable that goes through.
    expect(withEffects(counter, [LION, ENIGMA], items).core[0]?.effect).toBe("Spell immunity for the big fights. Black Hole still goes through it.");
  });
});
