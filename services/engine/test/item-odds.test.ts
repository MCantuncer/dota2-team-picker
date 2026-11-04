import { describe, expect, it } from "vitest";
import {
  bigItems,
  combine,
  fallbackOdds,
  fallbackSide,
  hasItems,
  bigItemCheck,
  type ItemGame,
  leadBucket,
  placeboPassRates,
  seeded,
  slotItem,
  slotOdds,
} from "../src/engine/item-odds";
import { simulate, simulateGames } from "../scripts/item-odds-sim";

// Ids 1 to 9 are big items, 50 is a component.
const isBig = (id: number) => id < 10;

function game(over: Partial<ItemGame> = {}): ItemGame {
  return {
    match: 1,
    account: 1,
    won: true,
    level: 25,
    version: 190,
    points: [],
    items: [],
    duration: 40 * 60,
    lead: Array.from({ length: 40 }, () => 0),
    ...over,
  };
}

const cell = (wins: number, losses: number) => ({ wins, losses });

describe("hasItems", () => {
  it("tells rows cached before the item fields", () => {
    expect(hasItems({ match: 1, account: 1, won: true, level: 20, version: 184, points: [] })).toBe(false);
    expect(hasItems(game())).toBe(true);
  });
});

describe("leadBucket", () => {
  it("reads the state at the minute, with 3,000 either way as even", () => {
    const lead = [0, -3001, -3000, 3000, 3001];
    expect([1, 2, 3, 4].map((m) => leadBucket(lead, m))).toEqual(["behind", "even", "even", "ahead"]);
    expect(leadBucket(lead, 5)).toBeUndefined();
  });
});

describe("bigItemCheck", () => {
  const item = (key: string, cost: number, components: number[] = []) => ({ key, name: key, cost, img: "", components });
  const isBig = bigItemCheck({
    "29": item("boots", 500),
    "63": item("power_treads", 1400, [29]),
    "108": item("radiance", 4700, [109]),
    "109": item("relic", 3750),
    "36": item("magic_wand", 450),
  });
  it("leaves out plain boots, small items and parts of other items", () => {
    expect([29, 63, 108, 109, 36].map(isBig)).toEqual([false, true, true, false, false]);
  });
  it("gives a Radiance game one slot, not two", () => {
    const g = game({ items: [[109, 600], [108, 900]] });
    expect(bigItems(g, isBig)).toEqual([[108, 900]]);
  });
});

describe("bigItems", () => {
  it("keeps each big item once, at its first purchase", () => {
    const g = game({ items: [[50, 100], [1, 600], [1, 700], [2, 900]] });
    expect(bigItems(g, isBig)).toEqual([[1, 600], [2, 900]]);
  });
});

describe("slotItem", () => {
  const g = game({ items: [[1, 600], [2, 15 * 60], [3, 21 * 60]] });
  it("takes the Nth big item when bought in the 6 minute window", () => {
    expect(slotItem(g, 2, 15, isBig)).toBe(2);
    expect(slotItem(g, 3, 15, isBig)).toBeUndefined();
    expect(slotItem(g, 2, 8, isBig)).toBeUndefined();
  });
  it("leaves out a game that ended by the minute", () => {
    expect(slotItem({ ...g, duration: 15 * 60 }, 2, 15, isBig)).toBeUndefined();
  });
});

describe("combine", () => {
  it("counts a bucket where B lost every game against B", () => {
    const first = { a: cell(10, 14), b: cell(14, 8) };
    const both = combine([first, { a: cell(6, 2), b: cell(0, 6) }]);
    expect(both.oddsRatio).toBeLessThan(combine([first]).oddsRatio);
    expect(both.games).toBe(60);
    expect(both.minCell).toBe(14);
  });
  it("leaves out a bucket with no games on one side", () => {
    const odds = combine([
      { a: cell(10, 10), b: cell(20, 10) },
      { a: cell(0, 0), b: cell(5, 5) },
    ]);
    expect(odds.games).toBe(50);
    expect(odds.minCell).toBe(10);
    expect(odds.oddsRatio).toBeGreaterThan(1);
    expect(odds.oddsRatio).toBeLessThan(2);
  });
  it("is 1 with nothing to compare", () => {
    expect(combine([]).oddsRatio).toBe(1);
    expect(combine([]).chance).toBeCloseTo(0.5);
    expect(combine([]).shows).toBe(false);
  });
  it("shows a clear difference with enough games, not one with a thin cell", () => {
    expect(combine([{ a: cell(15, 45), b: cell(45, 15) }]).shows).toBe(true);
    expect(combine([{ a: cell(4, 30), b: cell(30, 10) }]).shows).toBe(false);
  });
});

describe("slotOdds", () => {
  it("compares B with A inside each lead bucket", () => {
    // Ahead games bought B and won, behind games bought A and lost: the state, not the item.
    const ahead = Array.from({ length: 20 }, () => 6000);
    const behind = Array.from({ length: 20 }, () => -6000);
    const games = [
      ...Array.from({ length: 20 }, (_, i) => game({ won: i < 15, items: [[2, 960]], lead: ahead })),
      ...Array.from({ length: 20 }, (_, i) => game({ won: i < 15, items: [[1, 960]], lead: ahead })),
      ...Array.from({ length: 20 }, (_, i) => game({ won: i < 5, items: [[1, 960]], lead: behind })),
      ...Array.from({ length: 20 }, (_, i) => game({ won: i < 5, items: [[2, 960]], lead: behind })),
    ];
    const odds = slotOdds(games, { slot: 1, minute: 15, a: 1, b: 2 }, isBig);
    expect(odds.oddsRatio).toBeCloseTo(1);
    expect(odds.games).toBe(80);
    expect(odds.shows).toBe(false);
  });
});

describe("fallbackSide", () => {
  const late = 18;
  it("splits games without the key item at the late minute", () => {
    expect(fallbackSide(game({ items: [[5, 19 * 60]] }), 5, late, isBig)).toBe("kept");
    expect(fallbackSide(game({ items: [[3, 19 * 60], [5, 22 * 60]] }), 5, late, isBig)).toBe("switched");
  });
  it("leaves out games with the key item in time, no big item in the window, or too short", () => {
    expect(fallbackSide(game({ items: [[5, 17 * 60]] }), 5, late, isBig)).toBeUndefined();
    expect(fallbackSide(game({ items: [[5, 24 * 60]] }), 5, late, isBig)).toBeUndefined();
    expect(fallbackSide(game({ items: [[5, 19 * 60]], duration: 24 * 60 }), 5, late, isBig)).toBeUndefined();
  });
  it("counts the window's edges: in from the late minute, out at 6 minutes after", () => {
    expect(fallbackSide(game({ items: [[5, 18 * 60]] }), 5, late, isBig)).toBe("kept");
    expect(fallbackSide(game({ items: [[5, 24 * 60 - 1]] }), 5, late, isBig)).toBe("kept");
  });
  it("feeds the odds of switching against keeping", () => {
    const ahead = Array.from({ length: 30 }, () => 0);
    const games = [
      ...Array.from({ length: 40 }, (_, i) => game({ won: i < 30, items: [[3, 19 * 60]], lead: ahead })),
      ...Array.from({ length: 40 }, (_, i) => game({ won: i < 10, items: [[5, 19 * 60]], lead: ahead })),
    ];
    const odds = fallbackOdds(games, 5, late, isBig);
    // 9x in the games, pulled toward 1 by the prior.
    expect(odds.oddsRatio).toBeGreaterThan(2.5);
    expect(odds.oddsRatio).toBeLessThan(9);
    expect(odds.shows).toBe(true);
  });
});

describe("the bar, simulated", () => {
  const sample = { games: 400, inWindow: 0.6, bShare: 0.5 };
  it("rarely shows a line when the item makes no difference", () => {
    expect(simulate(sample, 1, 1000).shows).toBeLessThan(0.03);
  });
  it("shows more lines for bigger samples and bigger differences", () => {
    expect(simulate(sample, 3, 300).shows).toBeGreaterThan(simulate(sample, 1.5, 300).shows);
    expect(simulate(sample, 3, 300).shows).toBeGreaterThan(simulate({ ...sample, games: 200 }, 3, 300).shows);
  });
  it("shows almost nothing for one draft's 100 games", () => {
    expect(simulate({ ...sample, games: 100 }, 2, 500).shows).toBeLessThan(0.02);
  });
  it("makes the skewed samples the plan expects: wins mostly ahead", () => {
    const games = simulateGames({ games: 1000, inWindow: 1, bShare: 0.5 }, 1, seeded(3));
    const ahead = (won: boolean) => games.filter((g) => g.won === won && leadBucket(g.lead, 15) === "ahead").length;
    expect(ahead(true) / 500).toBeGreaterThan(0.45);
    expect(ahead(false) / 500).toBeLessThan(0.25);
  });
});

describe("placeboPassRates", () => {
  it("keeps shuffled questions near the no-difference rate", () => {
    const random = seeded(7);
    const questions = Array.from({ length: 20 }, () => ({
      games: simulateGames({ games: 400, inWindow: 0.6, bShare: 0.5 }, 3, random),
      minute: 15,
      ask: (g: ItemGame[]) => slotOdds(g, { slot: 1, minute: 15, a: 1, b: 2 }, () => true),
    }));
    const rates = placeboPassRates(questions, 20, seeded(9));
    expect(rates).toHaveLength(20);
    expect(Math.max(...rates)).toBeLessThanOrEqual(0.2);
  });
  it("is 0 with no questions", () => {
    expect(placeboPassRates([], 3, seeded(1))).toEqual([0, 0, 0]);
  });
});
