import { assertEquals } from "jsr:@std/assert@1";
import { readOpenDotaMatch } from "../report/match.ts";
import { buildPlayerFeedback, FEEDBACK_VERSION } from "./profile.ts";
import { type GameSummary, summarizeGame } from "./summary.ts";

const DAY_S = 24 * 60 * 60;
const NOW_S = 1_800_000_000;
const names = { hero: (id: number) => `Hero ${id}` };

const base = summarizeGame({
  match: readOpenDotaMatch(
    JSON.parse(Deno.readTextFileSync(new URL("../report/fixtures/all-pick-9072422905.json", import.meta.url))),
  ),
  accountId: 1000,
  startTime: 0,
  position: 2,
  items: {},
  heroIdsByKey: {},
})!;

/** A parsed game `daysAgo` days back, with a deaths percentile (high is bad) and no other signal. */
const game = (daysAgo: number, deathsPct: number, over: Partial<GameSummary> = {}): GameSummary => ({
  ...base,
  matchId: 1000 + daysAgo,
  startTime: NOW_S - daysAgo * DAY_S,
  laneNetWorthDiffAt10: null,
  deaths: [],
  percentiles: {
    goldPerMin: 0.5,
    xpPerMin: 0.5,
    lastHitsPerMin: 0.5,
    heroDamagePerMin: 0.5,
    killsPerMin: null,
    deathsPerMin: deathsPct,
    assistsPerMin: null,
    deniesPerMin: null,
    heroHealingPerMin: null,
    towerDamage: 0.5,
  },
  ...over,
});

Deno.test("sums up the last 14 days and leaves older games out", () => {
  const fb = buildPlayerFeedback([game(1, 0.9), game(2, 0.9), game(3, 0.9), game(4, 0.9), game(20, 0.9)], names, NOW_S);
  assertEquals([fb.version, fb.games, fb.parsedGames], [FEEDBACK_VERSION, 4, 4]);
  assertEquals([fb.firstGameAt, fb.lastGameAt], [NOW_S - 4 * DAY_S, NOW_S - DAY_S]);
  assertEquals(fb.findings.map((f) => [f.kind, f.tone]), [["deaths", "problem"]]);
  assertEquals(fb.improved, [], "no games last week");
});

Deno.test("a problem from last week that is gone this week shows as improved", () => {
  const lastWeek = [8, 9, 10, 11].map((d) => game(d, 0.9));
  const thisWeek = [1, 2, 3, 4].map((d) => game(d, 0.5));
  const fb = buildPlayerFeedback([...thisWeek, ...lastWeek], names, NOW_S);
  assertEquals(fb.improved, [{ kind: "deaths", headline: "Too many deaths" }]);
});

Deno.test("improved needs enough parsed games in both weeks", () => {
  const lastWeek = [8, 9, 10, 11].map((d) => game(d, 0.9));
  const thisWeek = [1, 2, 3].map((d) => game(d, 0.5)).concat(game(4, 0.5, { isParsed: false }));
  const fb = buildPlayerFeedback([...thisWeek, ...lastWeek], names, NOW_S);
  assertEquals([fb.improved, fb.parsedGames], [[], 7]);
});

Deno.test("no games gives empty feedback", () => {
  const fb = buildPlayerFeedback([], names, NOW_S);
  assertEquals([fb.games, fb.findings, fb.firstGameAt, fb.lastGameAt], [0, [], null, null]);
});
