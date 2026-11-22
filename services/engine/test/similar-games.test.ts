import { describe, expect, it } from "vitest";
import {
  closeness,
  closestGames,
  finishedBuys,
  MIN_ROLE_GAMES,
  similarSummary,
  type SimilarGame,
  type SimilarHeroAnswer,
  usualBuild,
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
