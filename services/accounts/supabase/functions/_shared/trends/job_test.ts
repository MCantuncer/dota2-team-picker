import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import type { HeroBenchmarks } from "./benchmarks.ts";
import type { CountedDraftGame } from "./drafts.ts";
import type { CountedStratzGame } from "./stratz.ts";
import type { FactItem, FactRow } from "../feedback/fact.ts";
import { summarizeGame } from "../feedback/summary.ts";
import {
  type FactsDeps,
  MAX_FACT_CALLS,
  OpenDotaBusy,
  runTrends,
  type TrendCheck,
  type TrendDeps,
  type TrendPlayer,
} from "./job.ts";

const NOW_S = 1_800_000_000;
const NO_FACTS = { facts: 0, feedback: 0, factCalls: 0, factsStopped: null };
const HOUR_S = 3600;
const MONKEY_KING = 114;

/** A won ranked carry game on Monkey King with high farm. */
const recentRow = (matchId: number, over: Record<string, unknown> = {}) => ({
  match_id: matchId,
  hero_id: MONKEY_KING,
  player_slot: 0,
  radiant_win: true,
  start_time: NOW_S - matchId * HOUR_S,
  duration: 2400,
  game_mode: 22,
  lobby_type: 7,
  leaver_status: 0,
  lane_role: 1,
  is_roaming: false,
  last_hits: 320,
  gold_per_min: 720,
  xp_per_min: 800,
  hero_damage: 40000,
  hero_healing: 0,
  kills: 10,
  ...over,
});

const low = (top: number) => [
  { percentile: 0.1, value: top * 0.2 },
  { percentile: 0.5, value: top * 0.5 },
  { percentile: 0.9, value: top * 0.8 },
];
const BENCHMARKS: HeroBenchmarks = {
  gold_per_min: low(800),
  xp_per_min: low(900),
  last_hits_per_min: low(9),
  hero_damage_per_min: low(1100),
};

const player = (over: Partial<TrendPlayer> = {}): TrendPlayer => ({
  user_id: "u1",
  account_id: 1001,
  hero_stats: {},
  pool: [],
  skip: [],
  has_recent_card: false,
  cards_off: false,
  ...over,
});

interface Stub {
  deps: TrendDeps;
  saved: [string, TrendCheck][];
  taken: number[];
  logged: string[];
  benchmarkFetches: number[];
}

function stub(players: TrendPlayer[], over: Partial<TrendDeps> = {}): Stub {
  const saved: [string, TrendCheck][] = [];
  const taken: number[] = [];
  const logged: string[] = [];
  const benchmarkFetches: number[] = [];
  const deps: TrendDeps = {
    takeCalls: (n) => {
      taken.push(n);
      return Promise.resolve(true);
    },
    claimPlayers: () => Promise.resolve(players),
    fetchStratzGames: () => Promise.resolve(null),
    fetchDraftGames: () => Promise.resolve([]),
    fetchRecentMatches: () => Promise.resolve([1, 2, 3, 4, 5, 6].map((id) => recentRow(id))),
    cachedBenchmarks: () => Promise.resolve(new Map()),
    fetchBenchmarks: (heroId) => {
      benchmarkFetches.push(heroId);
      return Promise.resolve(BENCHMARKS);
    },
    heroName: () => "Monkey King",
    save: (userId, check) => {
      saved.push([userId, check]);
      return Promise.resolve();
    },
    nowS: () => NOW_S,
    log: (message) => logged.push(message),
    ...over,
  };
  return { deps, saved, taken, logged, benchmarkFetches };
}

Deno.test("a strong winning streak opens one card and saves the games", async () => {
  const s = stub([player()]);
  const result = await runTrends(s.deps);
  assertEquals(result, { checked: 1, cards: 1, calls: 2, stopped: null, ...NO_FACTS });
  assertEquals(s.benchmarkFetches, [MONKEY_KING]);
  const [userId, check] = s.saved[0];
  assertEquals(userId, "u1");
  assertEquals(check.state, "ok");
  assertEquals(check.games.length, 6);
  assertEquals(check.games[0].position, 1);
  assertEquals(check.games[0].is_strong, true);
  assertEquals(check.qualifying, [`${MONKEY_KING}:1`]);
  assertEquals(check.newCard?.question, "Add Monkey King to your carry heroes?");
  assertStringIncludes(check.newCard?.reason ?? "", "You won 100% of your last 6 Monkey King games");
});

Deno.test("cached benchmarks cost no call", async () => {
  const s = stub([player()], { cachedBenchmarks: () => Promise.resolve(new Map([[MONKEY_KING, BENCHMARKS]])) });
  const result = await runTrends(s.deps);
  assertEquals(result.calls, 1);
  assertEquals(s.benchmarkFetches, []);
});

Deno.test("no games shown but games on record saves the hidden state", async () => {
  const s = stub([player({ hero_stats: { "114": { games: 40, wins: 22 } } })], {
    fetchRecentMatches: () => Promise.resolve([]),
  });
  await runTrends(s.deps);
  assertEquals(s.saved[0][1], { state: "hidden", games: [], newCard: null, qualifying: [] });
});

Deno.test("a card in the last days means no new card, but the pair still qualifies", async () => {
  const s = stub([player({ has_recent_card: true })]);
  const result = await runTrends(s.deps);
  assertEquals(result.cards, 0);
  assertEquals(s.saved[0][1].newCard, null);
  assertEquals(s.saved[0][1].qualifying, [`${MONKEY_KING}:1`]);
});

Deno.test("suggestions off: the games are still saved, but no new card", async () => {
  const s = stub([player({ cards_off: true })]);
  const result = await runTrends(s.deps);
  assertEquals(result.cards, 0);
  assertEquals(s.saved[0][1].newCard, null);
  assertEquals(s.saved[0][1].state, "ok");
  assertEquals(s.saved[0][1].games.length > 0, true);
});

Deno.test("heroes in the pool or skipped get no card", async () => {
  for (const p of [player({ pool: [{ heroId: MONKEY_KING, position: 0 }] }), player({ skip: [`${MONKEY_KING}:1`] })]) {
    const s = stub([p]);
    await runTrends(s.deps);
    assertEquals(s.saved[0][1].newCard, null);
    assertEquals(s.saved[0][1].qualifying, []);
  }
});

Deno.test("losses and turbo games do not make a card", async () => {
  const rows = [
    ...[1, 2, 3].map((id) => recentRow(id, { radiant_win: false })),
    ...[4, 5, 6].map((id) => recentRow(id)),
    ...[7, 8, 9, 10].map((id) => recentRow(id, { game_mode: 23 })),
  ];
  const s = stub([player()], { fetchRecentMatches: () => Promise.resolve(rows) });
  await runTrends(s.deps);
  assertEquals(s.saved[0][1].games.length, 6);
  assertEquals(s.saved[0][1].newCard, null);
});

Deno.test("a refused budget stops the run before the next player", async () => {
  let left = 3;
  const s = stub([player(), player({ user_id: "u2" }), player({ user_id: "u3" })], {
    takeCalls: (n) => {
      left -= n;
      return Promise.resolve(left >= 0);
    },
  });
  const result = await runTrends(s.deps);
  // u1 takes 2 calls (games + benchmarks), u2 takes 1 for games, then benchmarks are refused.
  assertEquals(result.stopped, "daily budget");
  assertEquals(s.saved.map(([id]) => id), ["u1"]);
});

Deno.test("the run cap stops the run without asking the budget", async () => {
  const s = stub([player(), player({ user_id: "u2" })]);
  const result = await runTrends(s.deps, 3);
  assertEquals(result, { checked: 1, cards: 1, calls: 3, stopped: "run cap", ...NO_FACTS });
  assertEquals(s.taken, [1, 1, 1]);
});

Deno.test("a 429 stops the run", async () => {
  const s = stub([player(), player({ user_id: "u2" })], {
    fetchRecentMatches: () => Promise.reject(new OpenDotaBusy()),
  });
  const result = await runTrends(s.deps);
  assertEquals(result.stopped, "rate limit");
  assertEquals(s.saved, []);
});

Deno.test("one player's error is logged and the others still run", async () => {
  const s = stub([player({ account_id: 1 }), player({ user_id: "u2" })], {
    fetchRecentMatches: (id) =>
      id === 1 ? Promise.reject(new Error("HTTP 500")) : Promise.resolve([1, 2, 3, 4, 5, 6].map((m) => recentRow(m))),
  });
  const result = await runTrends(s.deps);
  assertEquals(result.checked, 1);
  assertEquals(s.saved.map(([id]) => id), ["u2"]);
  assertEquals(s.logged, ["Trend check for u1 failed"]);
});

const stratzGame = (matchId: number, over: Partial<CountedStratzGame> = {}): CountedStratzGame => ({
  matchId,
  heroId: MONKEY_KING,
  startTime: NOW_S - matchId * HOUR_S,
  isWin: true,
  position: 1,
  imp: 30,
  gameMode: 22,
  lobbyType: 7,
  ...over,
});
const unparsed = () => Promise.resolve([1, 2, 3, 4, 5, 6].map((id) => recentRow(id, { lane_role: null })));

Deno.test("STRATZ positions and IMP make a card when OpenDota has no lanes, with no benchmark call", async () => {
  const s = stub([player()], {
    fetchRecentMatches: unparsed,
    fetchStratzGames: () => Promise.resolve([1, 2, 3, 4, 5, 6].map((id) => stratzGame(id))),
  });
  const result = await runTrends(s.deps);
  assertEquals(result, { checked: 1, cards: 1, calls: 1, stopped: null, ...NO_FACTS });
  assertEquals(s.benchmarkFetches, []);
  const check = s.saved[0][1];
  assertEquals(check.games[0].position_source, "stratz");
  assertEquals(check.games[0].imp, 30);
  assertStringIncludes(check.newCard?.reason ?? "", "STRATZ IMP averaged +30");
});

Deno.test("a STRATZ position without IMP is judged by benchmarks", async () => {
  const s = stub([player()], {
    fetchRecentMatches: unparsed,
    fetchStratzGames: () => Promise.resolve([1, 2, 3, 4, 5, 6].map((id) => stratzGame(id, { imp: null }))),
  });
  await runTrends(s.deps);
  assertEquals(s.benchmarkFetches, [MONKEY_KING]);
  assertEquals(s.saved[0][1].games[0].is_strong, true);
  assertEquals(s.saved[0][1].newCard !== null, true);
});

Deno.test("STRATZ only games keep their mode and lobby", async () => {
  const s = stub([player()], {
    fetchRecentMatches: () => Promise.resolve([]),
    fetchStratzGames: () => Promise.resolve([stratzGame(1, { gameMode: 2, lobbyType: 0 })]),
  });
  await runTrends(s.deps);
  assertEquals(s.saved[0][1].state, "ok");
  assertEquals([s.saved[0][1].games[0].game_mode, s.saved[0][1].games[0].lobby_type], [2, 0]);
});

Deno.test("a STRATZ error falls back to OpenDota alone", async () => {
  const s = stub([player()], { fetchStratzGames: () => Promise.reject(new Error("HTTP 502")) });
  const result = await runTrends(s.deps);
  assertEquals(result.cards, 1);
  assertEquals(s.logged, ["STRATZ games for u1 failed; using OpenDota alone"]);
});

const draftGame = (matchId: number, over: Partial<CountedDraftGame> = {}): CountedDraftGame => ({
  matchId,
  heroId: MONKEY_KING,
  startTime: NOW_S - matchId * HOUR_S,
  isWin: true,
  position: 1,
  gameMode: 22,
  lobbyType: 7,
  ...over,
});

Deno.test("draft positions let unparsed OpenDota games be judged and make a card", async () => {
  const s = stub([player()], {
    fetchRecentMatches: unparsed,
    fetchDraftGames: () => Promise.resolve([1, 2, 3, 4, 5, 6].map((id) => draftGame(id))),
  });
  const result = await runTrends(s.deps);
  assertEquals(result.cards, 1);
  assertEquals(s.benchmarkFetches, [MONKEY_KING]);
  assertEquals(s.saved[0][1].games[0].position_source, "draft");
  assertStringIncludes(s.saved[0][1].newCard?.reason ?? "", "as carry in your drafts");
});

Deno.test("STRATZ positions win over draft positions", async () => {
  const s = stub([player()], {
    fetchRecentMatches: unparsed,
    fetchStratzGames: () => Promise.resolve([1, 2, 3, 4, 5, 6].map((id) => stratzGame(id, { position: 2 }))),
    fetchDraftGames: () => Promise.resolve([1, 2, 3, 4, 5, 6].map((id) => draftGame(id))),
  });
  await runTrends(s.deps);
  assertEquals(s.saved[0][1].games[0].position, 2);
  assertEquals(s.saved[0][1].games[0].position_source, "stratz");
});

Deno.test("a draft read error falls back to the other sources", async () => {
  const s = stub([player()], { fetchDraftGames: () => Promise.reject(new Error("db down")) });
  const result = await runTrends(s.deps);
  assertEquals(result.cards, 1);
  assertEquals(s.logged, ["Draft games for u1 failed; using the other sources"]);
});

const factItem = (matchId: number): FactItem => ({
  user_id: "u1",
  account_id: 1000,
  match_id: matchId,
  hero_id: 4,
  position: 2,
  is_win: false,
  started_at: new Date(NOW_S * 1000 - matchId * 1000).toISOString(),
  created_at: null,
  duration_s: null,
  summary: null,
  summary_version: null,
  parse_requests: 0,
  parse_requested_at: null,
  attempts: 0,
});

function factsStub(items: FactItem[], over: Partial<FactsDeps> = {}) {
  const saved: FactRow[] = [];
  const order: string[] = [];
  const facts: FactsDeps = {
    purge: () => {
      order.push("purge");
      return Promise.resolve();
    },
    dueRows: () => Promise.resolve(items.slice(0, 1)),
    newGames: () => Promise.resolve(items.slice(1)),
    // A match OpenDota doesn't know yet: a new game saves nothing, a saved row counts an error.
    fetchMatch: () => Promise.resolve(null),
    requestParse: () => Promise.resolve(),
    summarize: () => null,
    findingsOf: () => [],
    refreshFeedback: (userId) => {
      order.push(`feedback ${userId}`);
      return Promise.resolve();
    },
    save: (row) => {
      saved.push(row);
      return Promise.resolve();
    },
    now: () => new Date(NOW_S * 1000),
    ...over,
  };
  return { facts, saved, order };
}

Deno.test("game feedback runs after the cards with its own call cap", async () => {
  const items = Array.from({ length: MAX_FACT_CALLS + 5 }, (_, i) => factItem(i + 1));
  items[0] = { ...items[0], created_at: new Date(NOW_S * 1000).toISOString(), duration_s: 1800 };
  const f = factsStub(items);
  const s = stub([player()], { facts: f.facts });
  const result = await runTrends(s.deps);
  assertEquals([result.checked, result.cards], [1, 1]);
  assertEquals([result.factCalls, result.calls, result.factsStopped], [MAX_FACT_CALLS, 2 + MAX_FACT_CALLS, "run cap"]);
  assertEquals(f.order, ["purge"]);
  assertEquals(f.saved.map((r) => [r.match_id, r.attempts]), [[1, 1]], "only the saved row records the error");
});

Deno.test("game feedback is skipped when the cards used up the day's budget", async () => {
  const f = factsStub([factItem(1)]);
  const s = stub([player()], { facts: f.facts, takeCalls: () => Promise.resolve(false) });
  const result = await runTrends(s.deps);
  assertEquals([result.stopped, result.factCalls], ["daily budget", 0]);
  assertEquals(f.order, []);
});

Deno.test("a rate limit stops game feedback; a save error only skips that game", async () => {
  const items = [1, 2, 3].map(factItem).map((it) => ({ ...it, created_at: it.started_at, duration_s: 1800 }));
  let fetches = 0;
  const f = factsStub(items, {
    dueRows: () => Promise.resolve(items),
    newGames: () => Promise.resolve([]),
    fetchMatch: () => (++fetches === 3 ? Promise.reject(new OpenDotaBusy()) : Promise.resolve(null)),
    save: (row) => (row.match_id === 1 ? Promise.reject(new Error("db")) : Promise.resolve()),
  });
  const s = stub([player()], { facts: f.facts });
  const result = await runTrends(s.deps);
  assertEquals([result.facts, result.factsStopped], [1, "rate limit"]);
  assertEquals(s.logged, ["Saving game 1 for u1 failed"]);
});

Deno.test("feedback is worked out again once for each player with a new summary", async () => {
  const raw = JSON.parse(
    Deno.readTextFileSync(new URL("../report/fixtures/all-pick-9072422905.json", import.meta.url)),
  );
  const items = [factItem(1), { ...factItem(2), user_id: "u2" }, factItem(3)];
  const f = factsStub(items, {
    dueRows: () => Promise.resolve([]),
    newGames: () => Promise.resolve(items),
    fetchMatch: () => Promise.resolve(raw),
    summarize: (match, item) =>
      summarizeGame({ match, accountId: item.account_id, startTime: 0, position: 2, items: {}, heroIdsByKey: {} }),
    refreshFeedback: (userId) => {
      f.order.push(`feedback ${userId}`);
      return userId === "u2" ? Promise.reject(new Error("db")) : Promise.resolve();
    },
  });
  const s = stub([], { facts: f.facts });
  const result = await runTrends(s.deps);
  assertEquals([result.facts, result.feedback], [3, 1]);
  assertEquals(f.order, ["purge", "feedback u1", "feedback u2"]);
  assertEquals(s.logged, ["Feedback for u2 failed"]);
});
