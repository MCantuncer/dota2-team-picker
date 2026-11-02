import { describe, expect, it } from "vitest";
import type { BuildItem, ItemBuild } from "../src/engine/item-build";
import { laneAdjusted } from "../src/engine/lane-items";
import type { HeroInfo, ItemInfo } from "../src/engine/types";

const item = (key: string, name: string, cost: number): ItemInfo => ({ key, name, cost, img: "", components: [] });
const ITEMS: Record<string, ItemInfo> = {
  11: item("quelling_blade", "Quelling Blade", 100),
  13: item("gauntlets", "Gauntlets of Strength", 140),
  16: item("branches", "Iron Branch", 55),
  20: item("circlet", "Circlet", 155),
  36: item("magic_wand", "Magic Wand", 460),
  39: item("flask", "Healing Salve", 100),
  44: item("tango", "Tango", 90),
  75: item("wraith_band", "Wraith Band", 505),
  237: item("faerie_fire", "Faerie Fire", 65),
  265: item("infused_raindrop", "Infused Raindrops", 225),
};
const hero = (id: number, name: string): HeroInfo => ({ id, name, roles: [], attackType: "Melee", primaryAttr: "str" });
const AXE = hero(2, "Axe");
const WITCH_DOCTOR = hero(30, "Witch Doctor");
const LION = hero(26, "Lion");
const LINA = hero(25, "Lina");
const SNIPER = hero(35, "Sniper");

const own = (id: number, minute: number, count?: number): BuildItem => ({
  itemId: id,
  name: ITEMS[id]!.name,
  img: "",
  minute,
  ...(count ? { count } : {}),
});
/** Juggernaut pos 1's usual start and lane this week. */
const juggernaut = (): ItemBuild => ({
  timings: "rank",
  start: [own(11, 0), own(44, 0), own(16, 0, 2), own(237, 0), own(20, 0)],
  lane: [own(75, 2), own(36, 5)],
  core: [],
  situational: [],
});
const names = (items: BuildItem[]) => items.map((i) => `${i.count ? `${i.count} ` : ""}${i.name}`);

describe("laneAdjusted", () => {
  it("keeps the usual start and lane in an even lane without threats", () => {
    const build = laneAdjusted(juggernaut(), { verdict: "even", enemies: [SNIPER] }, ITEMS);
    expect(build).toEqual(juggernaut());
  });

  it("buys sustain for a hard lane, paid for by Faerie Fire and Circlet", () => {
    const build = laneAdjusted(juggernaut(), { verdict: "hard", enemies: [AXE, SNIPER] }, ITEMS);
    expect(names(build.start)).toEqual(["Quelling Blade", "2 Tango", "2 Iron Branch", "Healing Salve"]);
    const salve = build.start.at(-1)!;
    expect(salve).toMatchObject({ draft: true, phase: "start", reason: "Hard lane against Axe and Sniper: more sustain", against: [2, 35] });
  });

  it("gives up one copy at a time", () => {
    const usual = { ...juggernaut(), start: [own(13, 0, 2), own(44, 0)] };
    const build = laneAdjusted(usual, { verdict: "hard", enemies: [AXE] }, ITEMS);
    // Two Gauntlets pay for the Salve and Tango (190 gold) only together.
    expect(names(build.start)).toEqual(["2 Tango", "Healing Salve"]);
    const cheaper = laneAdjusted({ ...usual, start: [own(13, 0, 2), own(20, 0), own(44, 0)] }, { verdict: "hard", enemies: [AXE] }, ITEMS);
    expect(names(cheaper.start)).toEqual(["Gauntlets of Strength", "2 Tango", "Healing Salve"]);
  });

  it("moves the Magic Wand early against spell spammers, and only when it changes", () => {
    const build = laneAdjusted(juggernaut(), { verdict: "even", enemies: [WITCH_DOCTOR] }, ITEMS);
    expect(build.lane[1]).toMatchObject({ name: "Magic Wand", minute: 3, draft: true, against: [30] });
    const already = { ...juggernaut(), lane: [own(36, 3)] };
    expect(laneAdjusted(already, { verdict: "even", enemies: [WITCH_DOCTOR] }, ITEMS).lane[0]!.draft).toBeUndefined();
  });

  it("adds Infused Raindrops against two burst heroes, or one in a hard lane", () => {
    const raindrops = (verdict: "even" | "hard", enemies: HeroInfo[]) =>
      laneAdjusted(juggernaut(), { verdict, enemies }, ITEMS).lane.some((i) => i.name === "Infused Raindrops");
    expect(raindrops("even", [LION])).toBe(false);
    expect(raindrops("even", [LION, LINA])).toBe(true);
    expect(raindrops("hard", [LION])).toBe(true);
  });
});
