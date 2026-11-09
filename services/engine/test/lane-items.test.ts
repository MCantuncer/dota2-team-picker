import { describe, expect, it } from "vitest";
import type { BuildItem, ItemBuild } from "../src/engine/item-build";
import { laneAdjusted } from "../src/engine/lane-items";
import type { HeroInfo, ItemInfo } from "../src/engine/types";

const item = (key: string, name: string, cost: number): ItemInfo => ({ key, name, cost, img: "", components: [] });
const ITEMS: Record<string, ItemInfo> = {
  11: item("quelling_blade", "Quelling Blade", 100),
  42: item("ward_observer", "Observer Ward", 0),
  43: item("ward_sentry", "Sentry Ward", 50),
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

  it("buys sustain for a hard lane, paid for by the Circlet and the 80 gold left", () => {
    const build = laneAdjusted(juggernaut(), { verdict: "hard", enemies: [AXE, SNIPER] }, ITEMS);
    expect(names(build.start)).toEqual(["Quelling Blade", "2 Tango", "2 Iron Branch", "Faerie Fire", "Healing Salve"]);
    const salve = build.start.at(-1)!;
    expect(salve).toMatchObject({ draft: true, phase: "start", reason: "Hard lane against Axe and Sniper: more sustain", against: [2, 35] });
  });

  it("gives up one copy at a time", () => {
    // 590 gold: two Gauntlets pay for the Salve and Tango (190 gold) only together.
    const usual = { ...juggernaut(), start: [own(13, 0, 2), own(44, 0), own(16, 0, 4)] };
    const build = laneAdjusted(usual, { verdict: "hard", enemies: [AXE] }, ITEMS);
    expect(names(build.start)).toEqual(["2 Tango", "4 Iron Branch", "Healing Salve"]);
    // 535 gold: the 65 left and one Gauntlets pay for it.
    const cheaper = laneAdjusted({ ...usual, start: [own(13, 0, 2), own(44, 0), own(16, 0, 3)] }, { verdict: "hard", enemies: [AXE] }, ITEMS);
    expect(names(cheaper.start)).toEqual(["Gauntlets of Strength", "2 Tango", "3 Iron Branch", "Healing Salve"]);
  });

  it("pays from gold the usual start leaves unspent before giving anything up", () => {
    const usual = { ...juggernaut(), start: [own(13, 0, 2), own(44, 0)] };
    const build = laneAdjusted(usual, { verdict: "hard", enemies: [AXE] }, ITEMS);
    expect(names(build.start)).toEqual(["2 Gauntlets of Strength", "2 Tango", "Healing Salve"]);
  });

  it("never starts with more than 600 gold, even with nothing optional to give up", () => {
    // 650 gold with the Salve and Tango, none of it on the give-up list: the Wand no longer fits.
    const support = { ...juggernaut(), start: [own(44, 0), own(36, 0), own(11, 0)] };
    const build = laneAdjusted(support, { verdict: "hard", enemies: [AXE] }, ITEMS);
    expect(names(build.start)).toEqual(["2 Tango", "Quelling Blade", "Healing Salve"]);
    expect(build.start.reduce((gold, i) => gold + ITEMS[i.itemId]!.cost * (i.count ?? 1), 0)).toBeLessThanOrEqual(600); // Every start id is in ITEMS.
  });

  it("keeps a support's wards in a hard lane, before a Magic Wand", () => {
    const support = { ...juggernaut(), start: [own(44, 0), own(36, 0), own(16, 0, 2), own(43, 0), own(42, 0)] };
    const build = laneAdjusted(support, { verdict: "hard", enemies: [AXE] }, ITEMS);
    expect(names(build.start)).toEqual(["2 Tango", "2 Iron Branch", "Sentry Ward", "Observer Ward", "Healing Salve"]);
  });

  it("cuts the usual start to 600 gold in any lane, the least held first", () => {
    const usual = { ...juggernaut(), start: [own(11, 0), own(44, 0), own(16, 0, 2), own(36, 0)] };
    expect(names(laneAdjusted(usual, { verdict: "even", enemies: [SNIPER] }, ITEMS).start)).toEqual(["Quelling Blade", "Tango", "2 Iron Branch"]);
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
