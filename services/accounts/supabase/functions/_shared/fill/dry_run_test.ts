import { assertEquals } from "jsr:@std/assert@1";
import type { HeroBenchmarks } from "../trends/benchmarks.ts";
import type { CountedDraftGame } from "../trends/drafts.ts";
import { dryRun, type DryRunDeps, MAX_BENCHMARK_CALLS, STRATZ_PAGE_SIZE, stratzPageInfo } from "./dry_run.ts";

const NOW_S = Date.parse("2026-11-06T12:00:00Z") / 1000;
const DAY_S = 24 * 60 * 60;
const MEDUSA = 94, PUDGE = 14;

/** A STRATZ match `daysAgo` back; position 0 means STRATZ didn't know it. */
const stratzMatch = (id: number, daysAgo: number, heroId = MEDUSA, position = 1, imp: number | null = 25) => ({
  id,
  startDateTime: NOW_S - daysAgo * DAY_S,
  durationSeconds: 2400,
  gameMode: "ALL_PICK_RANKED",
  lobbyType: "RANKED",
  players: [{
    heroId,
    position: position ? `POSITION_${position}` : "UNKNOWN",
    isVictory: id % 2 === 0,
    imp,
    leaverStatus: "NONE",
  }],
});
const page = (matches: unknown[]) => ({ player: { matches } });

/** An OpenDota row; lane 0 means unparsed. A laned row farms like a core. */
const odRow = (id: number, daysAgo: number, heroId = PUDGE, lane = 0) => ({
  match_id: id,
  hero_id: heroId,
  player_slot: 0,
  radiant_win: true,
  start_time: NOW_S - daysAgo * DAY_S,
  duration: 2400,
  game_mode: 22,
  lobby_type: 7,
  leaver_status: 0,
  lane_role: lane || null,
  is_roaming: false,
  last_hits: lane ? 200 : 50,
  gold_per_min: 300,
  xp_per_min: 400,
  hero_damage: 10000,
  hero_healing: 0,
  kills: 2,
});

function deps(over: Partial<DryRunDeps> = {}): DryRunDeps & { skips: number[]; calls: number; logs: string[] } {
  const d = {
    skips: [] as number[],
    calls: 0,
    logs: [] as string[],
    fetchStratzPage: (_: number, skip: number) => {
      d.skips.push(skip);
      return Promise.resolve(page([]));
    },
    fetchOpenDotaMatches: () => Promise.resolve([]),
    fetchDraftGames: () => Promise.resolve([] as CountedDraftGame[]),
    fetchRemovals: () => Promise.resolve(new Set<string>()),
    cachedBenchmarks: () => Promise.resolve(new Map<number, HeroBenchmarks>()),
    fetchBenchmarks: () => Promise.resolve({} as HeroBenchmarks),
    takeCalls: (n: number) => {
      d.calls += n;
      return Promise.resolve(true);
    },
    nowS: () => NOW_S,
    log: (message: string) => {
      d.logs.push(message);
    },
    ...over,
  };
  return d;
}

Deno.test("pages STRATZ until a page reaches past 6 months", async () => {
  const pages = [
    Array.from({ length: STRATZ_PAGE_SIZE }, (_, i) => stratzMatch(i + 1, 1 + i * 0.5)),
    Array.from({ length: STRATZ_PAGE_SIZE }, (_, i) => stratzMatch(i + 101, 60 + i * 2)),
    Array.from({ length: STRATZ_PAGE_SIZE }, (_, i) => stratzMatch(i + 201, 300 + i)),
  ];
  const d = deps({
    fetchStratzPage: (_, skip) => {
      d.skips.push(skip);
      return Promise.resolve(page(pages[skip / STRATZ_PAGE_SIZE] ?? []));
    },
  });
  const report = await dryRun("u1", 1001, d);
  assertEquals(d.skips, [0, 100]);
  assertEquals(report.sources.stratz, { status: "ok", games: 161, pages: 2 });
  assertEquals(report.coverage.bySource.stratz, 161);
  assertEquals(report.verdict, "go");
  assertEquals(report.fill.picks.map((p) => [p.heroId, p.position]), [[MEDUSA, 1]]);
});

Deno.test("stops on a short page and keeps one row per match", async () => {
  const d = deps({
    fetchStratzPage: (_, skip) => {
      d.skips.push(skip);
      return Promise.resolve(page([stratzMatch(1, 1), stratzMatch(1, 1), stratzMatch(2, 2)]));
    },
  });
  const report = await dryRun("u1", 1001, d);
  assertEquals(d.skips, [0]);
  assertEquals(report.sources.stratz.games, 2);
});

Deno.test("keeps the newer games when a later STRATZ page fails", async () => {
  const d = deps({
    fetchStratzPage: (_, skip) =>
      skip === 0
        ? Promise.resolve(page(Array.from({ length: STRATZ_PAGE_SIZE }, (_, i) => stratzMatch(i + 1, 1))))
        : Promise.reject(new Error("HTTP 500")),
  });
  const report = await dryRun("u1", 1001, d);
  assertEquals(report.sources.stratz, { status: "partial", games: 100, pages: 1 });
  assertEquals(d.logs, ["STRATZ page 2 for 1001 failed"]);
});

Deno.test("without STRATZ, OpenDota lanes alone go back to Can when too few games have a position", async () => {
  const rows = [
    ...Array.from({ length: 10 }, (_, i) => odRow(i + 1, i + 1, PUDGE, 2)),
    ...Array.from({ length: 30 }, (_, i) => odRow(i + 100, i + 1)),
  ];
  const d = deps({
    fetchStratzPage: () => Promise.resolve(null),
    fetchOpenDotaMatches: () => Promise.resolve(rows),
  });
  const report = await dryRun("u1", 1001, d);
  assertEquals(report.sources.stratz.status, "off");
  assertEquals(report.sources.openDota, { status: "ok", games: 40 });
  assertEquals(report.coverage, {
    games: 40,
    positioned: 10,
    positionedShare: 0.25,
    bySource: { stratz: 0, opendota: 10, draft: 0, none: 30 },
  });
  assertEquals(report.verdict, "back_to_can");
  assertEquals(report.fill.state, "too_few");
});

Deno.test("an empty budget skips OpenDota and its benchmarks", async () => {
  let asked = 0;
  const d = deps({
    takeCalls: () => {
      asked++;
      return Promise.resolve(false);
    },
    fetchOpenDotaMatches: () => Promise.reject(new Error("must not be called")),
  });
  const report = await dryRun("u1", 1001, d);
  assertEquals(report.sources.openDota, { status: "no_budget", games: 0 });
  assertEquals(asked, 1);
});

Deno.test("fetches benchmarks only for positioned games with no IMP, within the call cap", async () => {
  const heroes = Array.from({ length: MAX_BENCHMARK_CALLS + 5 }, (_, i) => i + 1);
  const rows = heroes.map((heroId, i) => odRow(1000 + i, 1, heroId, 2));
  const fetched: number[] = [];
  const d = deps({
    fetchStratzPage: () => Promise.resolve(null),
    fetchOpenDotaMatches: () => Promise.resolve([...rows, odRow(5000, 1, 120)]),
    cachedBenchmarks: () => Promise.resolve(new Map([[1, {}]])),
    fetchBenchmarks: (heroId) => {
      fetched.push(heroId);
      return Promise.resolve({});
    },
  });
  const report = await dryRun("u1", 1001, d);
  assertEquals(fetched.length, MAX_BENCHMARK_CALLS);
  assertEquals(fetched.includes(120), false);
  assertEquals(report.sources.benchmarks, { cached: 1, fetched: MAX_BENCHMARK_CALLS, missing: 4 });
  assertEquals(d.calls, 1 + MAX_BENCHMARK_CALLS);
});

Deno.test("counts strong games per position by what judged them", async () => {
  const d = deps({
    fetchStratzPage: () =>
      Promise.resolve(
        page([stratzMatch(1, 1, MEDUSA, 1, 30), stratzMatch(2, 1, MEDUSA, 1, 0), stratzMatch(3, 1, PUDGE, 0, null)]),
      ),
  });
  const report = await dryRun("u1", 1001, d);
  assertEquals(report.strong[1], { imp: { judged: 2, strong: 1 }, stats: { judged: 0, strong: 0 } });
  assertEquals(report.coverage.bySource.none, 1);
});

Deno.test("leaves out heroes the player removed", async () => {
  const d = deps({
    fetchStratzPage: () => Promise.resolve(page(Array.from({ length: 40 }, (_, i) => stratzMatch(i + 1, 1 + i)))),
    fetchRemovals: () => Promise.resolve(new Set([`${MEDUSA}:1`])),
  });
  const report = await dryRun("u1", 1001, d);
  assertEquals(report.fill.picks, []);
});

Deno.test("reads a page's size and oldest game", () => {
  assertEquals(stratzPageInfo(page([stratzMatch(1, 1), stratzMatch(2, 10)])), { count: 2, oldest: NOW_S - 10 * DAY_S });
  assertEquals(stratzPageInfo(null), { count: 0, oldest: null });
});
