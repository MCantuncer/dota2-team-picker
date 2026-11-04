import { describe, expect, it } from "vitest";
import {
  chooseMatchupTalents,
  type MatchupGame,
  normalCdf,
  poolGames,
  oddsLabel,
  tierReason,
  type TierChoice,
  tookFirst,
} from "../src/engine/matchup-talents";
import type { SkillBuildSlice } from "../src/engine/types";

// Sven's level 10 tier: 10 (+2 Mana Regen) or 11 (+15 Damage); level 15: 12 or 13.
const PAIRS = [
  [{ id: 10 }, { id: 11 }],
  [{ id: 12 }, { id: 13 }],
];
const NAMES: Record<number, string> = { 10: "+2 Mana Regen", 11: "+15 Damage", 12: "+20% Cleave", 13: "+8 Strength" };
const name = (id: number) => NAMES[id] ?? String(id);
const ENEMIES = ["Lion", "Lina", "Zeus", "Pudge", "Tidehunter"];

let next = 1;
/** `n` games, each by a different account, with talent `id` and the result `won`. */
const games = (n: number, id: number, won: boolean): MatchupGame[] =>
  Array.from({ length: n }, () => {
    const match = next++;
    return { match, account: match, won, level: 20, version: 184, points: [1, 2, id] };
  });

/** Usual pick 10 (+2 Mana Regen), with STRATZ totals that make both sides about even. */
const general = (
  sides = [
    { id: 10, games: 1000, wins: 500 },
    { id: 11, games: 1000, wins: 500 },
  ],
): SkillBuildSlice["talents"] => [{ tier: 0, id: 10, share: 0.55, games: 2000, level: 10, sides }];

// Every test here passes a level 10 tier with a full pair, so the first choice exists.
const tier = (g: MatchupGame[], gen = general()) => chooseMatchupTalents(PAIRS, gen, g)[0]!;

describe("normalCdf", () => {
  it("matches known values", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.6449)).toBeCloseTo(0.95, 4);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 4);
  });
});

describe("chooseMatchupTalents", () => {
  it("leans, not switches, on the plan's example: 29 won 12 lost against 6 won 11 lost", () => {
    const c = tier([...games(29, 11, true), ...games(12, 11, false), ...games(6, 10, true), ...games(11, 10, false)]);
    expect(c.sides).toEqual([
      { id: 10, wins: 6, losses: 11 },
      { id: 11, wins: 29, losses: 12 },
    ]);
    expect(c.oddsRatio).toBeCloseTo(2.3, 0);
    expect(c.result).toBe("leaning");
    expect(c.pick).toBe(10);
  });

  it("switches when the other talent is clearly better in many games", () => {
    const c = tier([...games(60, 11, true), ...games(15, 11, false), ...games(15, 10, true), ...games(40, 10, false)]);
    expect(c.result).toBe("recommended");
    expect(c.pick).toBe(11);
  });

  it("keeps the usual talent when the games show no clear difference", () => {
    const c = tier([...games(10, 11, true), ...games(10, 11, false), ...games(10, 10, true), ...games(10, 10, false)]);
    expect(c.result).toBe("no-clear-difference");
    expect(c.pick).toBe(10);
  });

  it("starts from STRATZ's overall odds: a talent that loses overall needs more to win here", () => {
    const g = [...games(29, 11, true), ...games(12, 11, false), ...games(6, 10, true), ...games(11, 10, false)];
    const even = tier(g);
    const worse = tier(
      g,
      general([
        { id: 10, games: 1000, wins: 600 },
        { id: 11, games: 1000, wins: 400 },
      ]),
    );
    expect(worse.chance).toBeLessThan(even.chance);
  });

  it("says too few games under 10 in a tier, and counts only games that reached it", () => {
    const c = chooseMatchupTalents(
      PAIRS,
      [...general(), { tier: 1, id: 13, share: 0.7, games: 9, level: 15 }],
      [...games(5, 11, true), ...games(4, 10, false)],
    );
    expect(c[0]!.result).toBe("too-few-games");
    // No game took a level 15 talent.
    expect(c[1]!.sides).toEqual([
      { id: 13, wins: 0, losses: 0 },
      { id: 12, wins: 0, losses: 0 },
    ]);
  });

  it("counts only the first talent of the pair: long games learn the other one too", () => {
    // Took +15 Damage at 10, then +2 Mana Regen past level 25.
    const long = games(12, 11, true).map((m) => ({ ...m, level: 30, points: [...m.points, 10] }));
    expect(tier(long).sides).toEqual([
      { id: 10, wins: 0, losses: 0 },
      { id: 11, wins: 12, losses: 0 },
    ]);
  });

  it("leaves out games that took neither talent of the tier", () => {
    const neither = games(30, 99, true);
    expect(tier([...neither, ...games(3, 10, false)]).sides).toEqual([
      { id: 10, wins: 0, losses: 3 },
      { id: 11, wins: 0, losses: 0 },
    ]);
  });

  it("starts from even odds when STRATZ's totals have no usable wins", () => {
    const g = [...games(29, 11, true), ...games(12, 11, false), ...games(6, 10, true), ...games(11, 10, false)];
    const noSides = tier(g, [{ tier: 0, id: 10, share: 0.55, games: 2000, level: 10 }]);
    const allWins = tier(
      g,
      general([
        { id: 10, games: 100, wins: 100 },
        { id: 11, games: 100, wins: 50 },
      ]),
    );
    expect(noSides.chance).toBe(tier(g).chance);
    expect(allWins.chance).toBe(tier(g).chance);
  });

  it("handles a side with no games at all", () => {
    const c = tier([...games(20, 10, true), ...games(20, 10, false)]);
    expect(c.sides[1]).toEqual({ id: 11, wins: 0, losses: 0 });
    expect(c.result).toBe("no-clear-difference");
    expect(Number.isFinite(c.oddsRatio)).toBe(true);
  });

  it("skips a tier whose pair is incomplete", () => {
    expect(chooseMatchupTalents([[{ id: 10 }]], general(), games(20, 10, true))).toEqual([]);
  });
});

describe("poolGames", () => {
  it("counts each match once, and at most 2 wins and 2 losses per account", () => {
    const g = (match: number, account: number): MatchupGame => ({
      match,
      account,
      won: true,
      level: 20,
      version: 184,
      points: [],
    });
    expect(poolGames([g(1, 7), g(1, 7), g(2, 7), g(3, 7), g(4, 8)]).map((m) => m.match)).toEqual([1, 2, 4]);
    // Losses of the same account have their own cap, so the order of wins and losses doesn't matter.
    const loss = (match: number) => ({ ...g(match, 7), won: false });
    expect(poolGames([g(1, 7), g(2, 7), g(3, 7), loss(5), loss(6), loss(8)]).map((m) => m.match)).toEqual([1, 2, 5, 6]);
  });
});

describe("oddsLabel", () => {
  it("gives the odds only when the games lean to the other talent", () => {
    const c = (result: TierChoice["result"]): TierChoice => ({
      tier: 0, usual: 10, pick: 10, result, oddsRatio: 1.8, chance: 0.9,
      sides: [{ id: 10, wins: 10, losses: 12 }, { id: 11, wins: 12, losses: 8 }],
    });
    expect(oddsLabel(c("recommended"))).toBe("1.8x the odds · 42 games");
    expect(oddsLabel(c("leaning"))).toBe("1.8x the odds · 42 games");
    expect(oddsLabel(c("no-clear-difference"))).toBeUndefined();
    expect(oddsLabel(c("too-few-games"))).toBeUndefined();
  });

  it("doesn't say most players take a talent picked half the time", () => {
    const c: TierChoice = { tier: 0, usual: 10, pick: 10, result: "no-clear-difference", oddsRatio: 1, chance: 0.5, sides: [{ id: 10, wins: 5, losses: 5 }, { id: 11, wins: 5, losses: 5 }] };
    expect(tierReason(c, name, ["Lion"], { share: 0.5, games: 40 })).toBe(
      "No clear difference against Lion, so take +2 Mana Regen, which players take as often as the other (50% of 40 recent games).",
    );
  });
});

describe("card lines", () => {
  it("are written from the numbers (golden examples)", async () => {
    const cases: [string, MatchupGame[]][] = [
      [
        "recommended",
        [...games(60, 11, true), ...games(15, 11, false), ...games(15, 10, true), ...games(40, 10, false)],
      ],
      ["leaning", [...games(29, 11, true), ...games(12, 11, false), ...games(6, 10, true), ...games(11, 10, false)]],
      [
        "no clear difference",
        [...games(10, 11, true), ...games(10, 11, false), ...games(10, 10, true), ...games(10, 10, false)],
      ],
      ["too few games", [...games(5, 11, true), ...games(4, 10, false)]],
    ];
    const lines = cases.map(([label, g]) => {
      const c: TierChoice = tier(g);
      const odds = oddsLabel(c);
      return `${label}:\n${tierReason(c, name, ENEMIES, { share: 0.55, games: 110 })}${odds ? `\n${odds}` : ""}`;
    });
    await expect(lines.join("\n\n") + "\n").toMatchFileSnapshot("./golden/talent-lines.txt");
  });
});

describe("tookFirst", () => {
  const pair = new Set([10, 11]);
  it("takes the first talent of the pair", () => {
    expect(tookFirst([1, 2, 11, 3, 10], pair)).toBe(11);
  });
  it("doesn't count a game where a point STRATZ sent as 0 comes before the pair", () => {
    // The 0 may be the real choice (10), with 11 learned past level 25.
    expect(tookFirst([1, 0, 2, 11], pair)).toBeUndefined();
  });
  it("counts a game whose 0 comes after the pair", () => {
    expect(tookFirst([1, 10, 0, 11], pair)).toBe(10);
  });
  it("is undefined when the game took neither", () => {
    expect(tookFirst([1, 2, 0], pair)).toBeUndefined();
  });
});
