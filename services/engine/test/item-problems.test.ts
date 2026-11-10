import { describe, expect, it } from "vitest";
import type { ItemGame } from "../src/engine/item-odds";
import { MIN_LOSSES, MIN_WINS, type PooledGame, poolByMatch, problemCell, shuffledProblem, usualMinute } from "../src/engine/item-problems";

const MKB = 135;
const BUTTERFLY = 139;
const isBig = Object.assign((id: number) => id === MKB || id === BUTTERFLY, { componentsOf: () => [] });
let next = 1;
/** A 40 minute game by a new player that bought `item` at minute 24 when given. */
const game = (won: boolean, item?: number): ItemGame => ({
  match: next++,
  account: next,
  won,
  level: 25,
  version: 1,
  points: [],
  items: item === undefined ? [] : [[item, 24 * 60]],
  duration: 40 * 60,
  lead: [],
});
const many = (n: number, won: boolean, item?: number) => Array.from({ length: n }, () => game(won, item));
/** Enemy 44 dodges attacks; enemy 2 doesn't. */
const dodges = (enemy: number) => enemy === 44;
const pool = (rows: { enemy: number; games: ItemGame[] }[]) => poolByMatch(rows, isBig);
const cases = (games: PooledGame[]) => games.map((g) => g.enemies.some(dodges));

describe("poolByMatch", () => {
  it("keeps each match once with every cached enemy it came back for and its big items", () => {
    const g = game(true, MKB);
    const pooled = pool([
      { enemy: 44, games: [g] },
      { enemy: 2, games: [g, game(false)] },
    ]);
    expect(pooled).toHaveLength(2);
    expect(pooled[0]).toEqual({ game: g, enemies: [44, 2], bought: new Map([[MKB, 24 * 60]]) });
  });

  it("keeps at most two wins of one player", () => {
    const same = [game(true), game(true), game(true)].map((g) => ({ ...g, account: 7 }));
    expect(pool([{ enemy: 2, games: same }])).toHaveLength(2);
  });
});

describe("problemCell", () => {
  it("passes when winners against the problem buy the item far more than usual, and more so than losers", () => {
    const games = pool([
      { enemy: 44, games: [...many(14, true, MKB), ...many(10, true), ...many(3, false, MKB), ...many(9, false)] },
      { enemy: 2, games: [...many(4, true, MKB), ...many(20, true), ...many(2, false, MKB), ...many(10, false)] },
    ]);
    const cell = problemCell(games, cases(games), MKB, 24);
    expect(cell?.caseWins).toEqual({ bought: 14, games: 24 });
    expect(cell?.caseLosses).toEqual({ bought: 3, games: 12 });
    expect(cell?.controlWins).toEqual({ bought: 4, games: 24 });
    expect(cell?.controlLosses).toEqual({ bought: 2, games: 12 });
    // (14 + 20 * 4/24) / (24 + 20) = 0.39, against 0.17 usually.
    expect(cell?.shrunk).toBeCloseTo(0.394, 2);
    expect(cell?.passes).toBe(true);
  });

  it("fails when losers against the problem went up as much as winners did", () => {
    const games = pool([
      { enemy: 44, games: [...many(14, true, MKB), ...many(10, true), ...many(7, false, MKB), ...many(5, false)] },
      { enemy: 2, games: [...many(4, true, MKB), ...many(20, true), ...many(1, false, MKB), ...many(11, false)] },
    ]);
    expect(problemCell(games, cases(games), MKB, 24)?.passes).toBe(false);
  });

  it("counts only purchases by the item's minute plus the horizon", () => {
    const late = (won: boolean): ItemGame => ({ ...game(won), items: [[MKB, 35 * 60]] });
    const games = pool([
      { enemy: 44, games: [...Array.from({ length: 24 }, () => late(true)), ...many(12, false)] },
      { enemy: 2, games: [...many(24, true), ...many(12, false)] },
    ]);
    expect(problemCell(games, cases(games), MKB, 24)?.caseWins.bought).toBe(0);
  });

  it("is undefined with too few games, and skips games over before the item's minute", () => {
    const games = pool([
      { enemy: 44, games: [...many(MIN_WINS - 1, true, MKB), ...many(MIN_LOSSES, false)] },
      { enemy: 2, games: [...many(MIN_WINS, true), ...many(MIN_LOSSES, false)] },
    ]);
    expect(problemCell(games, cases(games), MKB, 24)).toBeUndefined();
    const enough = pool([
      { enemy: 44, games: [...many(MIN_WINS, true, MKB), ...many(MIN_LOSSES, false)] },
      { enemy: 2, games: [...many(MIN_WINS, true), ...many(MIN_LOSSES, false)] },
    ]);
    expect(problemCell(enough, cases(enough), MKB, 24)).toBeDefined();
    // Every game is 40 minutes long, so none is still running 6 minutes after minute 35.
    expect(problemCell(enough, cases(enough), MKB, 35)).toBeUndefined();
  });
});

describe("shuffledProblem", () => {
  it("gives the problem to as many enemies as had it, chosen by the random stream", () => {
    const enemies = [44, 2, 5, 8, 11];
    expect(enemies.filter(shuffledProblem(enemies, dodges, () => 0.3))).toHaveLength(1);
    const holders = new Set([0.01, 0.3, 0.6, 0.99].map((x) => enemies.find(shuffledProblem(enemies, dodges, () => x))));
    expect(holders.size).toBeGreaterThan(1);
  });
});

describe("usualMinute", () => {
  it("is the median minute the item was bought at", () => {
    const at = (minute: number): ItemGame => ({ ...game(true), items: [[MKB, minute * 60]] });
    const games = pool([{ enemy: 2, games: [at(20), at(24), at(30), game(true)] }]);
    expect(usualMinute(games, MKB)).toBe(24);
    expect(usualMinute(games, BUTTERFLY)).toBeUndefined();
  });
});
