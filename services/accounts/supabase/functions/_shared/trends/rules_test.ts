import { assertAlmostEquals, assertEquals } from "jsr:@std/assert@1";
import type { Position, TrendGame } from "./games.ts";
import { type FindInput, findPoolCandidates, winLowerBound } from "./rules.ts";

const NOW_S = Date.parse("2026-11-02T12:00:00Z") / 1000;
const HOUR_S = 3600;
const MONKEY_KING = 114;

let nextId = 1;
function game(over: Partial<TrendGame> = {}): TrendGame {
  const matchId = nextId++;
  return {
    matchId,
    heroId: MONKEY_KING,
    // Spread over the last 20 days whatever the id, so later tests stay inside the window.
    startTime: NOW_S - (matchId % 480) * HOUR_S,
    isWin: true,
    position: 1,
    positionSource: "stratz",
    isStrong: true,
    imp: 30,
    percentiles: null,
    statValues: null,
    ...over,
  };
}
const games = (n: number, over: Partial<TrendGame> = {}) => Array.from({ length: n }, () => game(over));
const find = (input: Partial<FindInput>) =>
  findPoolCandidates({ games: [], pool: [], heroRecords: {}, skip: new Set(), nowS: NOW_S, ...input });

Deno.test("Wilson lower bounds match the plan's table", () => {
  assertAlmostEquals(winLowerBound(5, 5), 0.649, 0.001);
  assertAlmostEquals(winLowerBound(6, 7), 0.547, 0.001);
  assertAlmostEquals(winLowerBound(7, 8), 0.589, 0.001);
  assertAlmostEquals(winLowerBound(8, 10), 0.541, 0.001);
  assertEquals(winLowerBound(5, 6) < 0.5, true);
  assertEquals(winLowerBound(0, 0), 0);
});

Deno.test("Can's story: 9 straight strong Monkey King carry wins give one card", () => {
  const [card, ...rest] = find({ games: games(9) });
  assertEquals(rest.length, 0);
  assertEquals(card?.heroId, MONKEY_KING);
  assertEquals(card?.position, 1);
  assertEquals([card?.wins, card?.games, card?.strongGames], [9, 9, 9]);
});

Deno.test("9 wins spread over several heroes give no card", () => {
  const spread = [1, 2, 3].flatMap((heroId) => games(3, { heroId }));
  assertEquals(find({ games: spread }), []);
});

Deno.test("needs 5 games, a lower bound of 50% and 60% strong games", () => {
  assertEquals(find({ games: games(4) }), [], "4 games");
  assertEquals(find({ games: [...games(5), game({ isWin: false })] }), [], "5 of 6 is under the bound");
  const mostlyOrdinary = [...games(3), ...games(3, { isStrong: false, imp: 0 })];
  assertEquals(find({ games: mostlyOrdinary }), [], "half strong");
  const unknown = games(6, { isStrong: null, imp: null });
  assertEquals(find({ games: unknown }), [], "unknown strength counts as not strong");
});

Deno.test("skips heroes already in the pool at that position or any position, and open cards", () => {
  const g = games(6);
  assertEquals(find({ games: g, pool: [{ heroId: MONKEY_KING, position: 1 }] }), []);
  assertEquals(find({ games: g, pool: [{ heroId: MONKEY_KING, position: 0 }] }), []);
  assertEquals(find({ games: g, skip: new Set([`${MONKEY_KING}:1`]) }), []);
  assertEquals(find({ games: g, pool: [{ heroId: MONKEY_KING, position: 3 }] }).length, 1);
});

Deno.test("a poor long record needs 8 games", () => {
  const heroRecords = { [MONKEY_KING]: { games: 40, wins: 16 } };
  assertEquals(find({ games: games(6), heroRecords }), []);
  assertEquals(find({ games: games(8), heroRecords }).length, 1);
  assertEquals(find({ games: games(6), heroRecords: { [MONKEY_KING]: { games: 9, wins: 2 } } }).length, 1);
});

Deno.test("ignores games without a position and games older than 30 days", () => {
  assertEquals(find({ games: games(6, { position: null }) }), []);
  assertEquals(find({ games: games(6, { startTime: NOW_S - 31 * 24 * HOUR_S }) }), []);
});

Deno.test("marks cards whose positions came only from drafts", () => {
  const [card] = find({ games: games(5, { positionSource: "draft" }) });
  assertEquals(card?.isPositionFromDraftsOnly, true);
});

Deno.test("ranks by lower bound, then strong share", () => {
  const cards = find({ games: [...games(5, { heroId: 1 }), ...games(9, { heroId: 2 })] });
  assertEquals(cards.map((c) => c.heroId), [2, 1]);
});

Deno.test("standout is IMP when STRATZ judged the games, else the best benchmark stat", () => {
  assertEquals(find({ games: games(5) })[0]?.standout, { kind: "imp", averageImp: 30 });
  const byStats = games(5, {
    imp: null,
    percentiles: { gold_per_min: 0.8, xp_per_min: 0.7 },
    statValues: { gold_per_min: 640, xp_per_min: 700 },
  });
  assertEquals(find({ games: byStats })[0]?.standout, {
    kind: "stat",
    stat: "gold_per_min",
    averagePercentile: 0.8,
    averageValue: 640,
  });
});

/** Small seeded generator, so the simulation gives the same answer every run. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A 50% player: wins are coin flips, and winning lifts the stats (strong in 60% of wins,
 * 25% of losses). Fewer than 5% of 20 game stretches may produce any card.
 */
function falseCardRate(pickHero: (r: () => number) => [number, Position]): number {
  const random = rng(42);
  const runs = 2000;
  let withCard = 0;
  for (let run = 0; run < runs; run++) {
    const sample = Array.from({ length: 20 }, (_, i) => {
      const [heroId, position] = pickHero(random);
      const isWin = random() < 0.5;
      const isStrong = random() < (isWin ? 0.6 : 0.25);
      return game({ heroId, position, isWin, isStrong, imp: null, startTime: NOW_S - i * HOUR_S });
    });
    if (find({ games: sample }).length > 0) withCard++;
  }
  return withCard / runs;
}

Deno.test("a 50% player spread over heroes rarely gets a card", () => {
  const rate = falseCardRate((r) => [1 + Math.floor(r() * 6), (1 + Math.floor(r() * 2)) as Position]);
  assertEquals(rate < 0.05, true, `false card rate ${rate}`);
});

Deno.test("a 50% one trick rarely gets a card", () => {
  const rate = falseCardRate(() => [MONKEY_KING, 1]);
  assertEquals(rate < 0.05, true, `false card rate ${rate}`);
});
