import { describe, expect, it } from "vitest";
import {
  closeness,
  closestGames,
  DEATHS_BY,
  finishedBuys,
  fisherGreater,
  MIN_ROLE_GAMES,
  MIN_TARGET_GAMES,
  similarSummary,
  type SimilarGame,
  type SimilarHeroAnswer,
  usualBuild,
  whatWon,
} from "../src/engine/similar-games";
import type { ItemInfo } from "../src/engine/types";

/** A shop with a two-level item (Soul Booster into Octarine Core), a one-level item and a basic part. */
const item = (key: string, components: number[] = []): ItemInfo => ({ key, name: key, cost: 1000, img: "", components });
const ITEMS: Record<string, ItemInfo> = {
  "1": item("basic"),
  "2": item("soul_booster", [1]),
  "3": item("octarine_core", [2, 1]),
  "4": item("kaya", [1]),
  "5": item("meteor_hammer", [1]),
};

let nextMatch = 1000;
function game(over: Partial<SimilarGame> = {}): SimilarGame {
  return {
    match: nextMatch++,
    won: true,
    startTime: 1795040000,
    duration: 2400,
    sharedEnemies: 3,
    sharedAllies: 0,
    position: 2,
    lane: "mid",
    kills: 5,
    deaths: 5,
    assists: 5,
    networth: 15000,
    lastHits10: 40,
    buys: [],
    deathsAt: [],
    allies: [{ hero: 74, position: 2, lane: "mid" }],
    enemies: [{ hero: 11, position: 2, lane: "mid" }, { hero: 14, position: 4, lane: "off" }],
    ...over,
  };
}

const INPUT = { position: 2 as const, enemies: [11, 14, 26, 2, 44], allies: [8, 128, 129, 5], laneEnemy: 11, items: ITEMS };

function answer(games: SimilarGame[], over: Partial<SimilarHeroAnswer> = {}): SimilarHeroAnswer {
  return { hero: 74, level: 3, found: 140, games, pending: false, ...over };
}

describe("similarSummary", () => {
  it("counts only games in the asked position", () => {
    const games = [
      ...Array.from({ length: 8 }, () => game({ won: true })),
      ...Array.from({ length: 4 }, () => game({ won: false })),
      ...Array.from({ length: 5 }, () => game({ position: 4, won: false })),
    ];
    const s = similarSummary(answer(games), INPUT)!; // 12 mid games: enough.
    expect([s.games, s.wins, s.found]).toEqual([12, 8, 140]);
    // Shadow Fiend (11) and Pudge (14) are in every made-up game; the others in none.
    expect(s.enemies).toEqual([
      { hero: 11, games: 12, wins: 8 },
      { hero: 14, games: 12, wins: 8 },
      { hero: 26, games: 0, wins: 0 },
      { hero: 2, games: 0, wins: 0 },
      { hero: 44, games: 0, wins: 0 },
    ]);
  });

  it("gives no answer with too few role games or no level", () => {
    const few = Array.from({ length: MIN_ROLE_GAMES - 1 }, () => game());
    expect(similarSummary(answer(few), INPUT)).toBeNull();
    const many = Array.from({ length: MIN_ROLE_GAMES }, () => game());
    expect(similarSummary(answer(many, { level: null }), INPUT)).toBeNull();
    expect(similarSummary(answer(many), INPUT)?.games).toBe(MIN_ROLE_GAMES);
  });
});

describe("usualBuild", () => {
  it("keeps finished items, not parts built into a bigger item right away", () => {
    const g = game({ buys: [[1, -89], [4, 571], [2, 1500], [3, 1640]] });
    expect(finishedBuys(g, ITEMS)).toEqual([[4, 571], [3, 1640]]);
    // Soul Booster counts when it was not built into an Octarine Core that game, or was kept 5 minutes or more.
    expect(finishedBuys(game({ buys: [[2, 1500]] }), ITEMS)).toEqual([[2, 1500]]);
    expect(finishedBuys(game({ buys: [[2, 1200], [3, 1500]] }), ITEMS)).toEqual([[2, 1200], [3, 1500]]);
  });

  it("lists items half the games bought, by median minute", () => {
    const games = [
      game({ buys: [[4, 540], [5, 660]] }),
      game({ buys: [[4, 600], [5, 700]] }),
      game({ buys: [[4, 660], [3, 1500]] }),
      game({ buys: [[5, 720]] }),
    ];
    expect(usualBuild(games, ITEMS)).toEqual([
      { item: 4, minute: 10, games: 3 },
      { item: 5, minute: 12, games: 3 },
    ]);
  });
});

describe("closestGames", () => {
  it("scores shared enemies, shared allies and the known lane enemy", () => {
    const g = game({ sharedEnemies: 3, sharedAllies: 1 });
    expect(closeness(g, 11)).toBe(9);
    // Unknown lane enemy, or one who was in another lane that game: no lane points.
    expect(closeness(g, null)).toBe(7);
    expect(closeness(g, 14)).toBe(7);
    // A safe lane hero faces the enemy offlaner.
    expect(closeness(game({ lane: "safe" }), 14)).toBe(8);
  });

  it("picks the two closest wins and the closest loss, wins first", () => {
    const best = game({ sharedEnemies: 4 });
    const loss = game({ won: false, sharedEnemies: 3 });
    const older = game({ sharedEnemies: 3, match: 1 });
    const newer = game({ sharedEnemies: 3, match: 99999 });
    const worseLoss = game({ won: false, sharedEnemies: 2 });
    expect(closestGames([older, worseLoss, loss, newer, best], 11)).toEqual([best, newer, loss]);
  });

  it("fills with more of one result when the other is short", () => {
    const wins = [game(), game(), game(), game()];
    expect(closestGames(wins, null)).toHaveLength(3);
    const losses = [game({ won: false }), game({ won: false })];
    const one = game();
    expect(closestGames([...losses, one], null)).toEqual([one, ...[...losses].sort((a, b) => b.match - a.match)]);
  });
});

describe("fisherGreater", () => {
  it("matches the exact one-sided test", () => {
    // 11 of 11 won with the item, 30 of 44 without: C(41,11) / C(55,11).
    expect(fisherGreater(11, 11, 41, 55)).toBeCloseTo(0.026405, 6);
    // Lady tasting tea: 3 of 4 right out of 8 cups, 4 right in all.
    expect(fisherGreater(3, 4, 4, 8)).toBeCloseTo(17 / 70, 10);
    expect(fisherGreater(0, 5, 5, 10)).toBeCloseTo(1, 10);
  });
});

describe("whatWon", () => {
  const meteorBy = (minute: number) => [[5, minute * 60]] as [number, number][];
  const diesAt = (n: number) => Array.from({ length: n }, (_, i) => [300 + i * 60, 11] as [number, number | null]);

  it("shows an item and a deaths target that pass the corrected test, in game order", () => {
    const games = [
      // 14 wins: Meteor Hammer by 11, 1 death before 20.
      ...Array.from({ length: 14 }, () => game({ buys: meteorBy(11), deathsAt: diesAt(1) })),
      // 2 wins without it, 1 death. 14 losses without it and 5 deaths; 2 losses with it late.
      ...Array.from({ length: 2 }, () => game({ deathsAt: diesAt(1) })),
      ...Array.from({ length: 14 }, () => game({ won: false, deathsAt: diesAt(5) })),
      ...Array.from({ length: 2 }, () => game({ won: false, buys: meteorBy(16), deathsAt: diesAt(5) })),
    ];
    const targets = whatWon(games, ITEMS);
    expect(targets.map((t) => [t.kind, t.minute])).toEqual([["item", 11], ["deaths", DEATHS_BY]]);
    const [meteor, deaths] = targets;
    expect(meteor).toMatchObject({ item: 5, met: { games: 14, wins: 14 }, missed: { games: 18, wins: 2 } });
    expect(deaths).toMatchObject({ most: 1, met: { games: 16, wins: 16 }, missed: { games: 16, wins: 0 } });
    // Two tests tried: each p is doubled.
    expect(meteor!.p).toBeCloseTo(2 * fisherGreater(14, 14, 16, 32), 12);
  });

  it("shows nothing for a gap chance explains once every test is counted", () => {
    // 11 of 11 with the item, 30 of 44 without: p 0.026 alone, 0.053 once the deaths test is counted too.
    // Deaths split evenly (1 or 3 by minute 20) in wins and losses alike.
    const deaths = (i: number) => diesAt(i % 2 ? 3 : 1);
    const games = [
      ...Array.from({ length: 11 }, (_, i) => game({ buys: meteorBy(20), deathsAt: deaths(i) })),
      ...Array.from({ length: 30 }, (_, i) => game({ deathsAt: deaths(i + 1) })),
      ...Array.from({ length: 14 }, (_, i) => game({ won: false, deathsAt: deaths(i) })),
    ];
    expect(whatWon(games, ITEMS)).toEqual([]);
  });

  it("counts only games that lasted past the target minute", () => {
    // Short losses without the item must not count against it: they ended before minute 11.
    const games = [
      ...Array.from({ length: 8 }, () => game({ buys: meteorBy(11) })),
      ...Array.from({ length: 20 }, () => game({ won: false, duration: 600 })),
      ...Array.from({ length: 8 }, () => game({ won: false, buys: meteorBy(11) })),
    ];
    // Every game that lasted bought it: no side without it, no item test.
    expect(whatWon(games, ITEMS).filter((t) => t.kind === "item")).toEqual([]);
  });

  it("is left out of the summary while games are pending or too few", () => {
    const games = Array.from({ length: MIN_TARGET_GAMES - 1 }, () => game());
    expect(similarSummary(answer(games), INPUT)?.whatWon).toBeNull();
    const enough = [...games, game()];
    expect(similarSummary(answer(enough), INPUT)?.whatWon).toEqual([]);
    expect(similarSummary(answer(enough, { pending: true }), INPUT)?.whatWon).toBeNull();
  });
});
