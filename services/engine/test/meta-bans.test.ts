import { describe, expect, it } from "vitest";
import type { EvalMatch } from "../src/data/eval-matches";
import { banDays, buildBans, rankGroup, SAVE_LAG_S } from "../src/data/meta-bans";

const START = Date.parse("2026-11-18T21:28:00Z") / 1000;
const DAY = 24 * 60 * 60;

const game = (startTime: number, rankTier: number | null, bans: number[]): EvalMatch => ({ id: startTime, startTime, rankTier, radiantWin: true, picks: [], bans });

describe("rank groups", () => {
  it("matches the explorer's groups", () => {
    expect([15, 25, 35, 45, 55, 65, 75, 80].map(rankGroup)).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
    expect([null, 0, 5, 90].map(rankGroup)).toEqual([0, 0, 0, 0]);
  });
});

describe("ban days", () => {
  const games = [
    game(START + 60, 54, [32, 12]),
    game(START + 120, null, [32]),
    game(START + DAY + 60, 81, [12, 12]),
    game(START - 60, 24, [32]),
    game(START + 5 * DAY, 54, [1]),
  ];

  it("counts games and bans per day and rank slice, every rank first", () => {
    const [d0, d1] = banDays(games, START, [0, 1], START + 3 * DAY);
    expect(d0!.games).toEqual([2, 0, 0, 1, 0]);
    expect(d0!.heroes[32]).toEqual([2, 0, 0, 1, 0]);
    expect(d0!.heroes[12]).toEqual([1, 0, 0, 1, 0]);
    // A hero listed twice is one banned game.
    expect(d1!.heroes[12]).toEqual([1, 0, 0, 0, 1]);
  });

  it("calls a day complete once its saved games are all in", () => {
    expect(banDays(games, START, [0], START + DAY + SAVE_LAG_S - 1)[0]!.complete).toBe(false);
    expect(banDays(games, START, [0], START + DAY + SAVE_LAG_S)[0]!.complete).toBe(true);
  });

  it("splits this patch's days from the days before", () => {
    const bans = buildBans(games, new Date(START * 1000).toISOString(), START + 2 * DAY + 60);
    expect(bans.days.map((d) => d.index)).toEqual([0, 1, 2]);
    expect(bans.base.map((d) => d.index)).toEqual([-7, -6, -5, -4, -3, -2, -1]);
    expect(bans.base.at(-1)!.heroes[32]).toEqual([1, 1, 0, 0, 0]);
    expect(() => buildBans(games, "soon", START)).toThrow("can't be read");
  });
});
