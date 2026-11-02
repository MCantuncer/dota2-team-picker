import { describe, expect, it } from "vitest";
import { enemyList } from "../src/engine/enemy-list";
import type { ItemBuild } from "../src/engine/item-build";
import type { HeroInfo } from "../src/engine/types";

const hero = (id: number, name: string, roles: string[]): HeroInfo => ({ id, name, roles, attackType: "Melee", primaryAttr: "str" });
const AXE = hero(2, "Axe", ["Initiator", "Durable", "Disabler"]);
const PA = hero(44, "Phantom Assassin", ["Carry", "Escape"]);
const LICH = hero(31, "Lich", ["Support", "Nuker"]);

const build = (): ItemBuild => ({
  timings: "rank",
  start: [{ itemId: 39, name: "Healing Salve", img: "", minute: 0, phase: "start", draft: true, against: [2] }],
  lane: [],
  core: [{ itemId: 145, name: "Monkey King Bar", img: "", minute: 33, phase: "late", draft: true, against: [44] }],
  situational: [],
});

describe("enemyList", () => {
  const list = () =>
    enemyList(build(), [
      { hero: PA, inLane: false, laneSure: true },
      { hero: AXE, inLane: true, laneSure: true },
      { hero: LICH, inLane: true, laneSure: false },
    ]);

  it("puts the lane enemies first, with how sure their lane is", () => {
    expect(list().map((e) => [e.heroId, e.inLane, e.laneSure])).toEqual([
      [2, true, true],
      [31, true, false],
      [44, false, true],
    ]);
  });

  it("names the items that answer a hero, and a tip when none does", () => {
    const pa = list().find((e) => e.heroId === 44)!;
    expect(pa).toMatchObject({ threat: "Evasion: right clicks miss", answers: [145] });
    expect(pa.tip).toBeUndefined();
    // The hard lane's Salve is for the lane, not an answer to Axe.
    const axe = list().find((e) => e.heroId === 2)!;
    expect(axe).toMatchObject({ threat: "Starts fights and soaks your damage", answers: [] });
    expect(axe.tip).toContain("Don't focus them");
  });

  it("says when a hero needs nothing special", () => {
    const [sniper] = enemyList(null, [{ hero: hero(999, "Test Hero", []), inLane: false, laneSure: false }]);
    expect(sniper).toMatchObject({ threat: "No special threat", answers: [] });
    expect(enemyList(null, [{ hero: LICH, inLane: false, laneSure: false }])[0]!.threat).toBe("Magic burst");
  });
});
