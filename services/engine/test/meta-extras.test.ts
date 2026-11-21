import { describe, expect, it } from "vitest";
import type { EvalMatch } from "../src/data/eval-matches";
import type { MetaFile } from "../src/data/meta";
import { buildExtras, heroBuilds, heroMatchups, MIN_BUILD_GAMES, MIN_PAIR_GAMES, newItemIds, newItemUse } from "../src/data/meta-extras";
import type { ItemInfo, Position } from "../src/engine/types";

const START = Date.parse("2026-11-18T21:28:07Z") / 1000;
const PATCH = { name: "7.42", startedAt: "2026-11-18T21:28:07.000Z" };

const item = (cost: number, name = "Item"): ItemInfo => ({ key: name.toLowerCase(), name, cost, img: "", components: [] });
const ITEMS: Record<string, ItemInfo> = { 1: item(2050, "Blink Dagger"), 63: item(1400, "Power Treads"), 36: item(450, "Magic Wand"), 16: item(50, "Branches"), 1942: item(925, "Bloodslinger") };

type Pick = EvalMatch["picks"][number];
const pick = (heroId: number, position: Position | null, items?: number[], neutral?: number): Pick => ({
  heroId,
  radiant: true,
  position,
  ...(items ? { items } : {}),
  ...(neutral ? { neutral } : {}),
});
const game = (id: number, startTime: number, picks: Pick[]): EvalMatch => ({ id, startTime, rankTier: 50, radiantWin: true, picks, bans: [] });

describe("heroBuilds", () => {
  it("counts each item once a game, per position and for every position, leaving out cheap items", () => {
    const games = Array.from({ length: MIN_BUILD_GAMES }, (_, i) =>
      game(i, START + 60, [pick(8, i % 2 ? 1 : 2, i < 30 ? [1, 1, 63, 16, 36] : [63], i < 10 ? 300 : undefined)]),
    );
    const builds = heroBuilds(games, START, ITEMS);
    // 40 games in every position; each position alone has 20, under the minimum.
    expect(Object.keys(builds[8]!)).toEqual(["0"]);
    expect(builds[8]![0]).toEqual({
      games: 40,
      items: [
        [63, 40],
        [1, 30],
        [36, 30],
      ],
      neutral: [[300, 10]],
    });
  });

  it("skips games before the patch, picks without items and items under the share", () => {
    const games = [
      ...Array.from({ length: MIN_BUILD_GAMES }, (_, i) => game(i, START + 60, [pick(8, 1, i === 0 ? [1] : [63])])),
      game(100, START - 60, [pick(8, 1, [1])]),
      game(101, START + 60, [pick(8, 1)]),
    ];
    const build = heroBuilds(games, START, ITEMS)[8]!;
    expect(build[1]!.games).toBe(40);
    // One game of 40 with Blink is 2.5%, under the 5% share.
    expect(build[1]!.items).toEqual([[63, 39]]);
  });
});

describe("new items", () => {
  it("finds ids added since the list before the patch", () => {
    expect(newItemIds(ITEMS, { 1: ITEMS[1]!, 63: ITEMS[63]!, 36: ITEMS[36]!, 16: ITEMS[16]! })).toEqual([1942]);
  });

  it("counts games ending with each new item, in main slots or as the neutral, by hero", () => {
    const games = [
      game(1, START + 60, [pick(8, 1, [1942, 1942]), pick(9, 2, [1942]), pick(10, 3, [], 1950)]),
      game(2, START + 60, [pick(9, 2, [1942])]),
      game(3, START - 60, [pick(9, 2, [1942])]),
    ];
    expect(newItemUse([1950, 1942, 1955], games, START)).toEqual([
      {
        id: 1942,
        games: 3,
        heroes: [
          [9, 2],
          [8, 1],
        ],
      },
      { id: 1950, games: 1, heroes: [[10, 1]] },
      { id: 1955, games: 0, heroes: [] },
    ]);
  });
});

describe("heroMatchups", () => {
  it("lists the enemies a hero wins and loses most against, compared with its own average", () => {
    const enemies: Record<string, { games: number; wins: number }> = {};
    // Win rates 40% to 62% against enemies 2 to 13; a pair under MIN_PAIR_GAMES and the hero itself are skipped.
    for (let id = 2; id <= 13; id++) enemies[id] = { games: 1000, wins: 400 + (id - 2) * 20 };
    enemies[14] = { games: MIN_PAIR_GAMES - 1, wins: MIN_PAIR_GAMES - 1 };
    enemies[1] = { games: 5000, wins: 2500 };
    const out = heroMatchups({ 1: enemies, 2: { 1: { games: 1000, wins: 500 } } });
    expect(Object.keys(out)).toEqual(["1"]); // hero 2 has too few matchups
    expect(out[1]!.best.map((m) => m[0])).toEqual([13, 12, 11, 10, 9]);
    expect(out[1]!.best[0]).toEqual([13, 62, 1000]);
    expect(out[1]!.worst.map((m) => m[0])).toEqual([2, 3, 4, 5, 6]);
  });
});

describe("buildExtras", () => {
  const snapshot = { patch: PATCH, items: ITEMS, matchups: {} };
  const last = (newItems: number[]): MetaFile => ({
    computedAt: "",
    patch: PATCH,
    days: [],
    base: [],
    roles: {},
    extras: { buildGames: 0, builds: {}, newItems: newItems.map((id) => ({ id, games: 0, heroes: [] })), matchups: {} },
  });

  it("reads the item list from before the patch when the last file has no new items", async () => {
    const asked: number[] = [];
    const extras = await buildExtras(
      {
        games: async () => [game(1, START + 60, [pick(8, 1, [1942])]), game(2, START + 60, [pick(8, 1)])],
        itemsBefore: async (start) => {
          asked.push(start);
          return { 1: ITEMS[1]!, 63: ITEMS[63]!, 36: ITEMS[36]!, 16: ITEMS[16]! };
        },
      },
      snapshot,
      START + 3600,
      null,
    );
    expect(asked).toEqual([START]);
    expect(extras.buildGames).toBe(1);
    expect(extras.newItems).toEqual([{ id: 1942, games: 1, heroes: [[8, 1]] }]);
  });

  it("keeps the new items found earlier in the same patch", async () => {
    const extras = await buildExtras(
      {
        games: async () => [],
        itemsBefore: async () => {
          throw new Error("not read");
        },
      },
      snapshot,
      START + 3600,
      last([1942]),
    );
    expect(extras.newItems.map((n) => n.id)).toEqual([1942]);
  });

  it("has no new items when there is no copy from before the patch", async () => {
    const extras = await buildExtras({ games: async () => [], itemsBefore: async () => null }, snapshot, START + 3600, null);
    expect(extras.newItems).toEqual([]);
  });
});
