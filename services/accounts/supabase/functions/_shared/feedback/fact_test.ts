import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { MAX_ERRORS, MAX_PARSE_REQUESTS } from "../report/build.ts";
import {
  accountIdOf,
  buildFact,
  type FactDeps,
  type FactItem,
  MAX_GAMES_PER_PLAYER,
  pickNewGames,
  readDueRows,
  readNewGames,
} from "./fact.ts";
import { type GameSummary, summarizeGame } from "./summary.ts";

const NOW = new Date("2026-11-03T12:00:00Z");
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

const parsedRaw = (): Record<string, unknown> =>
  JSON.parse(Deno.readTextFileSync(new URL("../report/fixtures/all-pick-9072422905.json", import.meta.url)));
/** The same match before OpenDota parsed it: no `version`. */
const basicRaw = () => {
  const raw = parsedRaw();
  delete raw.version;
  return raw;
};

const item = (over: Partial<FactItem> = {}): FactItem => ({
  user_id: "u1",
  account_id: 1000,
  match_id: 9072422905,
  hero_id: 4,
  position: 2,
  is_win: false,
  started_at: ago(2 * HOUR_MS),
  created_at: null,
  duration_s: null,
  summary: null,
  summary_version: null,
  parse_requests: 0,
  parse_requested_at: null,
  attempts: 0,
  ...over,
});

class Busy extends Error {}

function stub(raw: unknown, over: Partial<FactDeps> = {}) {
  const taken: number[] = [];
  const parses: number[] = [];
  const deps: FactDeps = {
    take: (n) => {
      taken.push(n);
      return Promise.resolve();
    },
    fetchMatch: () => Promise.resolve(raw),
    requestParse: (id) => {
      parses.push(id);
      return Promise.resolve();
    },
    summarize: (match, it) =>
      summarizeGame({
        match,
        accountId: it.account_id,
        startTime: Date.parse(it.started_at) / 1000,
        position: it.position,
        items: {},
        heroIdsByKey: {},
      }),
    now: NOW,
    ...over,
  };
  return { deps, taken, parses };
}
const isBusy = (err: unknown) => err instanceof Busy;

Deno.test("a parsed match is saved as parsed with its summary, using one call", async () => {
  const { deps, taken, parses } = stub(parsedRaw());
  const row = await buildFact(item(), deps, isBusy);
  assertEquals([row?.status, row?.summary_version, row?.attempts, row?.error], ["parsed", 1, 0, null]);
  assertEquals((row?.summary as GameSummary).isParsed, true);
  assertEquals(row?.duration_s, parsedRaw().duration);
  assertEquals([taken, parses], [[1], []]);
});

Deno.test("an unparsed match keeps the basic summary and asks for a parse", async () => {
  const { deps, taken, parses } = stub(basicRaw());
  const row = await buildFact(item(), deps, isBusy);
  assertEquals([row?.status, row?.parse_requests, row?.parse_requested_at], ["waiting_parse", 1, NOW.toISOString()]);
  assertEquals((row?.summary as GameSummary).isParsed, false);
  assertEquals(row?.next_try_at, new Date(NOW.getTime() + 10 * 60 * 1000).toISOString());
  assertEquals([taken, parses], [[1, 1], [9072422905]]);
});

Deno.test("a parse is not asked again before its gap is over", async () => {
  const { deps, taken, parses } = stub(basicRaw());
  const row = await buildFact(
    item({ created_at: ago(HOUR_MS), parse_requests: 2, parse_requested_at: ago(5 * 60 * 1000) }),
    deps,
    isBusy,
  );
  assertEquals([row?.status, row?.parse_requests, taken, parses], ["waiting_parse", 2, [1], []]);
});

Deno.test("after the last parse request it waits a day from the row's start, then stays basic", async () => {
  const waiting = item({
    created_at: ago(2 * HOUR_MS),
    parse_requests: MAX_PARSE_REQUESTS,
    parse_requested_at: ago(HOUR_MS),
  });
  const first = await buildFact(waiting, stub(basicRaw()).deps, isBusy);
  assertEquals([first?.status, first?.next_try_at], ["waiting_parse", ago(2 * HOUR_MS - DAY_MS)]);

  const done = await buildFact({ ...waiting, created_at: ago(DAY_MS) }, stub(basicRaw()).deps, isBusy);
  assertEquals(done?.status, "basic");
});

Deno.test("a game older than 14 days is saved as basic without a parse request", async () => {
  const { deps, parses } = stub(basicRaw());
  const row = await buildFact(item({ started_at: ago(15 * DAY_MS) }), deps, isBusy);
  assertEquals([row?.status, parses], ["basic", []]);
});

Deno.test("a new game whose match can't be read yet saves nothing", async () => {
  assertEquals(await buildFact(item(), stub(null).deps, isBusy), null);
  const failing = stub(null, { fetchMatch: () => Promise.reject(new Error("HTTP 500")) });
  assertEquals(await buildFact(item(), failing.deps, isBusy), null);
});

Deno.test("an error on a saved row counts, keeps its summary and waits longer each time", async () => {
  const saved = item({ created_at: ago(HOUR_MS), duration_s: 2000, summary: { kept: true }, summary_version: 1 });
  const row = await buildFact({ ...saved, attempts: 1 }, stub(null).deps, isBusy);
  assertEquals([row?.status, row?.attempts, row?.duration_s], ["waiting_parse", 2, 2000]);
  assertEquals([row?.summary, row?.summary_version], [{ kept: true }, 1]);
  assertEquals(row?.error, "OpenDota doesn't have the match yet");
  assertEquals(row?.next_try_at, new Date(NOW.getTime() + 20 * 60 * 1000).toISOString());
});

Deno.test("after the last error it stops trying until the row is removed at 60 days", async () => {
  const started = ago(3 * DAY_MS);
  const row = await buildFact(
    item({ created_at: ago(HOUR_MS), duration_s: 2000, started_at: started, attempts: MAX_ERRORS - 1 }),
    stub(null).deps,
    isBusy,
  );
  assertEquals(row?.next_try_at, new Date(Date.parse(started) + 60 * DAY_MS).toISOString());
});

Deno.test("a player missing from the match gets a waiting row with the error", async () => {
  const row = await buildFact(item({ account_id: 42 }), stub(parsedRaw()).deps, isBusy);
  assertEquals([row?.status, row?.attempts, row?.summary], ["waiting_parse", 1, null]);
  assertEquals(row?.error, "The player's account is not in the match");
});

Deno.test("budget refusals and rate limits stop the run instead of counting as errors", async () => {
  const refused = stub(parsedRaw(), { take: () => Promise.reject(new Busy()) });
  await assertRejects(() => buildFact(item(), refused.deps, isBusy), Busy);
  const limited = stub(parsedRaw(), { fetchMatch: () => Promise.reject(new Busy()) });
  await assertRejects(() => buildFact(item(), limited.deps, isBusy), Busy);
});

Deno.test("new games: the newest ten per player in the last 14 days without a row, newest first", () => {
  const game = (user: string, matchId: number, hoursAgo: number) => ({
    user_id: user,
    account_id: 1,
    match_id: matchId,
    hero_id: 1,
    position: null,
    is_win: true,
    started_at: ago(hoursAgo * HOUR_MS),
  });
  const games = [
    ...Array.from({ length: 12 }, (_, i) => game("a", 100 + i, i + 1)),
    game("b", 200, 5),
    game("b", 201, 15 * 24),
  ];
  const picked = pickNewGames(games, (u, m) => u === "a" && m === 100, NOW);
  assertEquals(
    picked.map((g) => g.match_id),
    [101, 102, 103, 104, 200, 105, 106, 107, 108, 109],
    "a's newest is saved already, its 11th and 12th are past the cap, b's old game is out",
  );
  assertEquals(MAX_GAMES_PER_PLAYER, 10);
  assertEquals([picked[0].created_at, picked[0].attempts, picked[0].duration_s], [null, 0, null]);
});

Deno.test("Steam ids turn into account ids; anything else is refused", () => {
  assertEquals(accountIdOf("76561197960266728"), 1000);
  assertEquals([accountIdOf(null), accountIdOf("123"), accountIdOf("76561197960265728")], [null, null, null]);
});

Deno.test("readers skip rows without a linked Steam account or with odd values", () => {
  const base = {
    user_id: "u1",
    match_id: 5,
    hero_id: 4,
    position: 9,
    is_win: true,
    started_at: ago(HOUR_MS),
    profiles: { steam_id: "76561197960266728" },
  };
  assertEquals(readNewGames([base, { ...base, profiles: { steam_id: null } }, { ...base, hero_id: "4" }]), [
    {
      user_id: "u1",
      account_id: 1000,
      match_id: 5,
      hero_id: 4,
      position: null,
      is_win: true,
      started_at: base.started_at,
    },
  ]);
  const due = readDueRows([
    {
      ...base,
      profiles: [{ steam_id: "76561197960266728" }],
      position: 2,
      created_at: ago(HOUR_MS),
      duration_s: 1800,
      summary: { a: 1 },
      summary_version: 1,
      parse_requests: 2,
      parse_requested_at: null,
      attempts: 1,
    },
    { ...base, created_at: ago(HOUR_MS) },
  ]);
  assertEquals(due.length, 1, "a row needs its duration");
  assertEquals([due[0].position, due[0].duration_s, due[0].parse_requests, due[0].summary], [2, 1800, 2, { a: 1 }]);
});
