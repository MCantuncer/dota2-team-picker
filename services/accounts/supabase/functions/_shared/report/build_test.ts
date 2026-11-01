import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { type BuildDeps, buildReport, type ClaimedReport, OpenDotaBusy, PARSE_WAIT_MS } from "./build.ts";

const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(Deno.readTextFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

// All Pick 9072422905: Dire won. Our party played Dire and won.
const parsed = () => fixture("all-pick-9072422905.json");
const unparsed = () => {
  const raw = parsed();
  delete raw.version;
  return raw;
};

const NOW = new Date("2026-11-02T12:00:00Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

const report = (over: Partial<ClaimedReport> = {}): ClaimedReport => ({
  draft_id: "d1",
  match_id: 9072422905,
  won: true,
  parse_requests: 0,
  parse_requested_at: null,
  attempts: 0,
  created_at: minutesAgo(5),
  ...over,
});

function deps(raw: unknown | Error, over: Partial<BuildDeps> = {}) {
  const calls = { parses: 0, saved: [] as number[] };
  const d: BuildDeps = {
    fetchMatch: () => (raw instanceof Error ? Promise.reject(raw) : Promise.resolve(raw)),
    requestParse: () => {
      calls.parses += 1;
      return Promise.resolve();
    },
    saveRawMatch: (id) => {
      calls.saved.push(id);
      return Promise.resolve();
    },
    draftLists: () => Promise.resolve([{ heroId: 145, shown: [1, 145] }]),
    items: {},
    now: NOW,
    ...over,
  };
  return { d, calls };
}

Deno.test("a parsed match makes a ready report and keeps the raw match", async () => {
  const { d, calls } = deps(parsed());
  const update = await buildReport(report(), d);
  assertEquals(update.status, "ready");
  assertEquals([update.facts?.side, update.facts?.won, update.facts?.isBasic], ["dire", true, false]);
  assertEquals(update.facts?.draft, [{ heroId: 145, suggestionRank: 2, listSize: 2 }]);
  assertEquals([update.facts_version, update.game_mode, update.lobby_type], [1, 22, 0]);
  assertEquals([update.attempts, update.error, update.lease_until], [0, null, null]);
  assertEquals([calls.saved, calls.parses], [[9072422905], 0]);
});

Deno.test("the side comes from the party's result", async () => {
  const { d } = deps(parsed());
  const update = await buildReport(report({ won: false }), d);
  assertEquals([update.facts?.side, update.facts?.won], ["radiant", false]);
});

Deno.test("an unparsed match saves a basic report and asks for a parse", async () => {
  const { d, calls } = deps(unparsed());
  const update = await buildReport(report(), d);
  assertEquals([update.status, update.facts?.isBasic], ["waiting_parse", true]);
  assertEquals([update.parse_requests, update.parse_requested_at], [1, NOW.toISOString()]);
  assertEquals(update.next_try_at, "2026-11-02T12:10:00.000Z", "the first gap is 10 minutes");
  assertEquals([calls.parses, calls.saved.length], [1, 0]);
});

Deno.test("parse requests come at growing gaps", async () => {
  const early = deps(unparsed());
  const waiting = await buildReport(report({ parse_requests: 2, parse_requested_at: minutesAgo(15) }), early.d);
  assertEquals([early.calls.parses, waiting.parse_requests], [0, 2], "the second gap is 20 minutes");
  assertEquals(waiting.next_try_at, "2026-11-02T12:05:00.000Z");

  const due = deps(unparsed());
  const asked = await buildReport(report({ parse_requests: 2, parse_requested_at: minutesAgo(20) }), due.d);
  assertEquals([due.calls.parses, asked.parse_requests], [1, 3]);
  assertEquals(asked.next_try_at, "2026-11-02T12:40:00.000Z", "then 40 minutes");
});

Deno.test("after five parse requests and a day the report stays basic", async () => {
  const { d, calls } = deps(unparsed());
  const waiting = await buildReport(report({ parse_requests: 5, created_at: minutesAgo(60) }), d);
  assertEquals([waiting.status, calls.parses], ["waiting_parse", 0]);
  assertEquals(Date.parse(waiting.next_try_at), Date.parse(minutesAgo(60)) + PARSE_WAIT_MS);

  const done = await buildReport(report({ parse_requests: 5, created_at: minutesAgo(24 * 60) }), d);
  assertEquals([done.status, done.facts?.isBasic], ["basic", true]);
});

Deno.test("errors are counted and retried, and the fifth one fails the report", async () => {
  const { d } = deps(null);
  const first = await buildReport(report(), d);
  assertEquals([first.status, first.attempts, first.error], [
    "waiting_parse",
    1,
    "OpenDota doesn't have the match yet",
  ]);
  assertEquals(first.facts, undefined, "an earlier basic report is kept");
  assertEquals(first.next_try_at, "2026-11-02T12:10:00.000Z");

  const last = await buildReport(report({ attempts: 4 }), deps(new Error("HTTP 500")).d);
  assertEquals([last.status, last.attempts, last.error], ["failed", 5, "HTTP 500"]);
});

Deno.test("a broken match, a missing result or a failed save count as errors", async () => {
  assertEquals((await buildReport(report(), deps({ match_id: 1 }).d)).attempts, 1);
  assertEquals((await buildReport(report({ won: null }), deps(parsed()).d)).error, "The draft has no result saved");
  const failedSave = deps(parsed(), { saveRawMatch: () => Promise.reject(new Error("Storage down")) });
  const update = await buildReport(report(), failedSave.d);
  assertEquals([update.status, update.error, update.facts], ["waiting_parse", "Storage down", undefined]);
  const long = await buildReport(report(), deps(new Error("x".repeat(900))).d);
  assertEquals(long.error?.length, 500);
});

Deno.test("OpenDota rate limiting stops the run without counting an error", async () => {
  await assertRejects(() => buildReport(report(), deps(new OpenDotaBusy()).d), OpenDotaBusy);
});
