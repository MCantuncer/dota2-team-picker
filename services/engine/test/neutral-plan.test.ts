import { describe, expect, it } from "vitest";
import type { EvalMatch } from "../src/data/eval-matches";
import { countNeutralChoices, MIN_MINUTE_CRAFTS, pickChoices } from "../src/data/neutral-choices";
import { MIN_ENCHANT_PICKS, MIN_TIER_PICKS, neutralPlan } from "../src/engine/neutral-plan";
import type { NeutralItem, NeutralPool, Position } from "../src/engine/types";

const START = 1795037287;
const art = (name: string, tier: number, extra: Partial<NeutralItem> = {}): NeutralItem => ({ key: name, name, img: `/${name}.png`, kind: "artifact", tier, ...extra });
const ench = (name: string): NeutralItem => ({ key: name, name, img: `/${name}.png`, kind: "enchantment", levels: [[], []] });
const POOL: NeutralPool = {
  at: "",
  tiers: [
    {
      tier: 1,
      minute: 0,
      craftCost: 6,
      options: 5,
      pools: [[10, 11], [12]],
      enchants: { global: [[90, 1]], strength: [[91, 1]], agility: [[92, 1]], intelligence: [], universal: [] },
    },
    { tier: 2, minute: 15, craftCost: 10, options: 5, pools: [[20, 21, 22]], enchants: { global: [[90, 2]], strength: [[91, 2]], agility: [], intelligence: [], universal: [] } },
  ],
  items: {
    10: art("Chipped Vest", 1),
    11: art("Possessed Mask", 1),
    12: art("Dormant Curio", 1),
    20: art("Imp Claw", 2),
    21: art("Divine Regalia", 2),
    22: art("Defiant Shell", 2),
    23: art("Disgraced Regalia", 2, { brokenOf: 21 }),
    90: ench("Quickened"),
    91: ench("Brawny"),
    92: ench("Alert"),
  },
};

type Pick = EvalMatch["picks"][number];
const pick = (heroId: number, position: Position | null, extra: Partial<Pick>): Pick => ({ heroId, radiant: true, position, ...extra });
const game = (id: number, picks: Pick[], startTime = START + 60): EvalMatch => ({ id, startTime, rankTier: 50, radiantWin: true, picks, bans: [] });

describe("pickChoices", () => {
  it("takes each tier's last craft and first minute from a parsed game", () => {
    const p = pick(1, 1, {
      neutral: 21,
      crafts: [
        [11, 90, 9],
        [20, 91, 22],
        [21, 0, 30],
        [99, 0, 40],
      ],
    });
    expect(pickChoices(p, POOL)).toEqual([
      { tier: 1, artifact: 11, enchant: 90, minute: 9 },
      { tier: 2, artifact: 21, minute: 22 },
    ]);
  });

  it("falls back to the end-of-game neutral item, a used-up one as the one it was", () => {
    expect(pickChoices(pick(1, 1, { neutral: 23, enchant: 91 }), POOL)).toEqual([{ tier: 2, artifact: 21, enchant: 91 }]);
    expect(pickChoices(pick(1, 1, { neutral: 999 }), POOL)).toEqual([]);
    expect(pickChoices(pick(1, 1, {}), POOL)).toEqual([]);
  });
});

describe("countNeutralChoices", () => {
  it("counts per hero and position, every position and every hero, skipping games before the patch", () => {
    const games = [
      game(1, [pick(1, 1, { neutral: 20 }), pick(2, 5, { neutral: 22 })]),
      game(2, [pick(1, 2, { neutral: 21 }), pick(2, null, { neutral: 22 })]),
      game(3, [pick(1, 1, { neutral: 20 })], START - 60),
      game(4, [pick(3, 1, {})]),
    ];
    const c = countNeutralChoices(games, START, POOL);
    expect(c.games).toBe(2);
    expect(c.heroes[1]![1]![2]).toEqual({ picks: 1, artifacts: [[20, 1]], enchants: [] });
    expect(c.heroes[1]![0]![2]!.artifacts).toEqual([
      [20, 1],
      [21, 1],
    ]);
    expect(c.heroes[2]![0]![2]!.picks).toBe(2);
    expect(c.positions[0]![2]!.picks).toBe(4);
    expect(c.positions[5]![2]!.picks).toBe(1);
    expect(c.heroes[3]).toBeUndefined();
  });

  it("keeps the usual craft minute once enough crafts have one", () => {
    const crafted = (minute: number) => pick(1, 1, { crafts: [[10, 0, minute]] });
    const few = countNeutralChoices([game(1, Array.from({ length: MIN_MINUTE_CRAFTS - 1 }, (_, i) => crafted(8 + i)))], START, POOL);
    expect(few.heroes[1]![1]![1]!.minute).toBeUndefined();
    const enough = countNeutralChoices([game(1, [8, 9, 10, 11, 30].map(crafted))], START, POOL);
    expect(enough.heroes[1]![1]![1]!.minute).toEqual([10, 5]);
  });
});

describe("neutralPlan", () => {
  const heroes = { 1: { id: 1, name: "Axe", roles: [], attackType: "Melee" as const, primaryAttr: "str" }, 2: { id: 2, name: "Lina", roles: [], attackType: "Ranged" as const, primaryAttr: "int" } };
  const many = (n: number, p: (i: number) => Pick) => Array.from({ length: n }, (_, i) => game(i, [p(i)]));

  it("is null without a neutral pool", () => {
    expect(neutralPlan({ heroes }, 1, 1)).toBeNull();
  });

  it("orders a tier by this hero and position's choices once there are enough", () => {
    const games = many(MIN_TIER_PICKS, (i) => pick(1, 3, { neutral: i < 9 ? 22 : 20, enchant: i < 8 ? 91 : 90 }));
    const plan = neutralPlan({ neutrals: POOL, neutralChoices: countNeutralChoices(games, START, POOL), heroes }, 1, 3)!;
    const t2 = plan[1]!;
    expect(t2.from).toEqual({ source: "hero-position", picks: 12 });
    expect(t2.artifacts.map((a) => [a.name, a.share])).toEqual([
      ["Defiant Shell", 75],
      ["Imp Claw", 25],
    ]);
    // Axe is Strength: every hero's Quickened and Strength's Brawny, at tier 2's level, most chosen first.
    expect(t2.enchants.map((e) => [e.name, e.level, e.share])).toEqual([
      ["Brawny", 2, 67],
      ["Quickened", 2, 33],
    ]);
    expect(t2.enchantFrom).toEqual({ source: "hero-position", picks: 12 });
    expect(t2.unlock).toBe(15);
  });

  it("falls back to the hero in any position, then the position over every hero", () => {
    const hero = many(MIN_TIER_PICKS, (i) => pick(1, i % 2 ? 1 : 2, { neutral: 20 }));
    expect(neutralPlan({ neutrals: POOL, neutralChoices: countNeutralChoices(hero, START, POOL), heroes }, 1, 1)![1]!.from).toEqual({ source: "hero", picks: 12 });
    const others = many(MIN_TIER_PICKS, () => pick(2, 1, { neutral: 21 }));
    const plan = neutralPlan({ neutrals: POOL, neutralChoices: countNeutralChoices(others, START, POOL), heroes }, 1, 1)!;
    expect(plan[1]!.from).toEqual({ source: "position", picks: 12 });
    expect(plan[1]!.artifacts.map((a) => a.name)).toEqual(["Divine Regalia"]);
  });

  it("lists what the game can offer, unranked, when no games have enough choices", () => {
    const plan = neutralPlan({ neutrals: POOL, neutralChoices: { games: 0, heroes: {}, positions: {} }, heroes }, 2, 2)!;
    expect(plan[0]!.from).toBeUndefined();
    expect(plan[0]!.artifacts.map((a) => [a.name, a.share])).toEqual([
      ["Chipped Vest", undefined],
      ["Possessed Mask", undefined],
      ["Dormant Curio", undefined],
    ]);
    // Lina is Intelligence: tier 1 has no Intelligence enchantment, so only every hero's.
    expect(plan[0]!.enchants.map((e) => e.name)).toEqual(["Quickened"]);
    expect(plan[0]!.enchantFrom).toBeUndefined();
    expect(MIN_ENCHANT_PICKS).toBeLessThan(MIN_TIER_PICKS);
  });
});
