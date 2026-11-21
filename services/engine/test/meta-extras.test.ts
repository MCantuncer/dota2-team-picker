import { describe, expect, it } from "vitest";
import type { EvalMatch } from "../src/data/eval-matches";
import type { MetaFile } from "../src/data/meta";
import { buildExtras, heroBuilds, heroMatchups, MIN_BUILD_GAMES, MIN_BUY_GAMES, MIN_PAIR_GAMES, newItemIds, newItemUse } from "../src/data/meta-extras";
import type { ItemInfo, Position } from "../src/engine/types";

const START = Date.parse("2026-11-18T21:28:07Z") / 1000;
const PATCH = { name: "7.42", startedAt: "2026-11-18T21:28:07.000Z" };

const item = (cost: number, name = "Item"): ItemInfo => ({ key: name.toLowerCase(), name, cost, img: "", components: [] });
const ITEMS: Record<string, ItemInfo> = { 1: item(2050, "Blink Dagger"), 63: item(1400, "Power Treads"), 36: item(450, "Magic Wand"), 16: item(50, "Branches"), 1942: item(925, "Bloodslinger") };

type Pick = EvalMatch["picks"][number];
const pick = (heroId: number, position: Position | null, items?: number[], neutral?: number, buys?: [number, number][]): Pick => ({
  heroId,
  radiant: true,
  position,
  ...(items ? { items } : {}),
  ...(neutral ? { neutral } : {}),
  ...(buys ? { buys } : {}),
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

describe("buy minutes in builds", () => {
  it("gives each build item its usual minute and lists early items once there are enough parsed games", () => {
    // 40 games, the first MIN_BUY_GAMES parsed: Bloodslinger at 6 or 8 min, Treads at 9 to 11, Blink at 20.
    const games = Array.from({ length: MIN_BUILD_GAMES }, (_, i) =>
      game(i, START + 60, [
        pick(8, 2, [1942, 63, 1], undefined, i < MIN_BUY_GAMES ? [[1942, i % 2 ? 6 : 8], [63, 9 + (i % 3)], [1, 20]] : undefined),
      ]),
    );
    const build = heroBuilds(games, START, ITEMS)[8]![2]!;
    expect(build.buyGames).toBe(MIN_BUY_GAMES);
    expect(build.minutes).toEqual([
      [1, 20],
      [63, 10],
      [1942, 7],
    ]);
    // Blink costs more than the early cut and comes later than its minute.
    expect(build.early).toEqual([
      [63, MIN_BUY_GAMES],
      [1942, MIN_BUY_GAMES],
    ]);
  });

  it("leaves buy minutes out with too few parsed games", () => {
    const games = Array.from({ length: MIN_BUILD_GAMES }, (_, i) => game(i, START + 60, [pick(8, 2, [63], undefined, i === 0 ? [[63, 9]] : undefined)]));
    const build = heroBuilds(games, START, ITEMS)[8]![2]!;
    expect(build).not.toHaveProperty("minutes");
    expect(build).not.toHaveProperty("early");
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

  it("adjusts for each enemy's strength, so an enemy that beats everyone is not a counter", () => {
    const vs = (wins: number) => ({ games: 1000, wins });
    // Hero 1 against enemies 2 to 12: 50% against most, 44% against 2 (which wins 60% overall) and 46% against 3
    // (which wins 40% overall). Rows for 2 and 3 give their overall rates.
    const one: Record<string, { games: number; wins: number }> = {};
    for (let id = 2; id <= 12; id++) one[id] = vs(500);
    one[2] = vs(440);
    one[3] = vs(460);
    const strong: Record<string, { games: number; wins: number }> = {};
    const weak: Record<string, { games: number; wins: number }> = {};
    for (let id = 4; id <= 14; id++) {
      strong[id] = vs(600);
      weak[id] = vs(400);
    }
    const out = heroMatchups({ 1: one, 2: strong, 3: weak });
    // By raw win rate 2 is the worst; by strength 3 is: hero 1 loses to a hero that loses to everyone else.
    expect(out[1]!.worst.map((m) => m[0]).slice(0, 2)).toEqual([3, 2]);
    expect(out[1]!.worst[0]).toEqual([3, 46, 1000]);
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
    extras: { buildGames: 0, builds: {}, newItems: newItems.map((id) => ({ id, games: 0, heroes: [] })), matchups: {}, items: {}, patchNotes: { 74: { lines: [], changes: 2 } } },
  });

  it("reads the item list from before the patch when the last file has no new items", async () => {
    const asked: number[] = [];
    const extras = await buildExtras(
      {
        games: async () => [game(1, START + 60, [pick(8, 1, [1942])]), game(2, START + 60, [pick(8, 1)])],
        patchNotes: async () => ({ 8: { lines: [{ ability: "Hero", text: "Base Agility increased from 21 to 22", tone: 1 }], changes: 1 } }),
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
    // Shop data for the items shown, and only those.
    expect(Object.keys(extras.items)).toEqual(["1942"]);
    expect(extras.patchNotes[8]!.changes).toBe(1);
  });

  it("keeps the new items found earlier in the same patch", async () => {
    const extras = await buildExtras(
      {
        games: async () => [],
        itemsBefore: async () => {
          throw new Error("not read");
        },
        patchNotes: async () => {
          throw new Error("OpenDota is down");
        },
      },
      snapshot,
      START + 3600,
      last([1942]),
    );
    expect(extras.newItems.map((n) => n.id)).toEqual([1942]);
    // Notes that cannot be read keep the last ones of the same patch.
    expect(Object.keys(extras.patchNotes)).toEqual(["74"]);
  });

  it("has no new items when there is no copy from before the patch", async () => {
    const extras = await buildExtras({ games: async () => [], itemsBefore: async () => null, patchNotes: async () => ({}) }, snapshot, START + 3600, null);
    expect(extras.newItems).toEqual([]);
  });
});
