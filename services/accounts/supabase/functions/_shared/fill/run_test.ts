import { assertEquals } from "jsr:@std/assert@1";
import type { HeroBenchmarks } from "../trends/benchmarks.ts";
import type { CountedDraftGame } from "../trends/drafts.ts";
import type { DryRunDeps } from "./dry_run.ts";
import {
  type FillOutcome,
  type FillSave,
  type FillStore,
  RETRY_FILLS_PER_RUN,
  RETRY_MIN_LEFT_MS,
  retryDueFills,
  runFill,
} from "./run.ts";

const NOW_S = Date.parse("2026-11-07T12:00:00Z") / 1000;
const DAY_S = 24 * 60 * 60;
const MEDUSA = 94;
const PLAYER = "11111111-1111-1111-1111-111111111111";

/** A STRATZ match `daysAgo` back at position 1, won every other game. */
const stratzMatch = (id: number, daysAgo: number, heroId = MEDUSA) => ({
  id,
  startDateTime: NOW_S - daysAgo * DAY_S,
  durationSeconds: 2400,
  gameMode: "ALL_PICK_RANKED",
  lobbyType: "RANKED",
  players: [{ heroId, position: "POSITION_1", isVictory: id % 2 === 0, imp: 25, leaverStatus: "NONE" }],
});
/** One short STRATZ page of `n` Medusa games, so paging stops after it. */
const medusaPage = (n: number) => ({
  player: { matches: Array.from({ length: n }, (_, i) => stratzMatch(i + 1, i + 1)) },
});

function readDeps(over: Partial<DryRunDeps> = {}): DryRunDeps & { logs: string[] } {
  const d = {
    logs: [] as string[],
    fetchStratzPage: () => Promise.resolve(medusaPage(30) as unknown),
    fetchOpenDotaMatches: () => Promise.resolve([]),
    fetchDraftGames: () => Promise.resolve([] as CountedDraftGame[]),
    fetchRemovals: () => Promise.resolve(new Set<string>()),
    cachedBenchmarks: () => Promise.resolve(new Map<number, HeroBenchmarks>()),
    fetchBenchmarks: () => Promise.resolve({} as HeroBenchmarks),
    takeCalls: () => Promise.resolve(true),
    nowS: () => NOW_S,
    log: (message: string) => {
      d.logs.push(message);
    },
    ...over,
  };
  return d;
}

function store(over: Partial<FillStore> = {}): FillStore & { saves: FillSave[]; fails: number } {
  const s = {
    saves: [] as FillSave[],
    fails: 0,
    claim: () => Promise.resolve(true),
    steamAccount: () => Promise.resolve(123 as number | null),
    save: (_: string, save: FillSave) => {
      s.saves.push(save);
      return Promise.resolve(save.picks.length as number | null);
    },
    fail: () => {
      s.fails++;
      return Promise.resolve("waiting" as string | null);
    },
    ...over,
  };
  return s;
}

Deno.test("does nothing when the fill can't be claimed", async () => {
  const s = store({ claim: () => Promise.resolve(false) });
  assertEquals(await runFill(PLAYER, "welcome", s, readDeps()), { claimed: false });
  assertEquals(s.saves.length + s.fails, 0);
});

Deno.test("saves the picks a player's games earn", async () => {
  const s = store();
  const outcome = await runFill(PLAYER, "welcome", s, readDeps());
  assertEquals(outcome, { claimed: true, state: "done", added: 1 });
  assertEquals(s.saves[0].result, "done");
  assertEquals(s.saves[0].positions, [1]);
  assertEquals(s.saves[0].positionedGames, 30);
  const [pick] = s.saves[0].picks;
  assertEquals([pick.position, pick.hero_id, pick.games, pick.wins], [1, MEDUSA, 30, 15]);
  assertEquals(pick.last_played, NOW_S - DAY_S);
});

Deno.test("saves no games for a player without a Steam account or any games", async () => {
  const noSteam = store({ steamAccount: () => Promise.resolve(null) });
  assertEquals((await runFill(PLAYER, "button", noSteam, readDeps())).claimed, true);
  assertEquals(noSteam.saves[0], { result: "no_games", positions: [], picks: [], positionedGames: 0 });

  const noGames = store();
  await runFill(PLAYER, "button", noGames, readDeps({ fetchStratzPage: () => Promise.resolve(medusaPage(0)) }));
  assertEquals(noGames.saves[0].result, "no_games");
});

Deno.test("saves too few when the games have too few positions, with no picks", async () => {
  const s = store();
  await runFill(PLAYER, "welcome", s, readDeps({ fetchStratzPage: () => Promise.resolve(medusaPage(10)) }));
  assertEquals(s.saves[0], { result: "too_few", positions: [], picks: [], positionedGames: 10 });
});

Deno.test("marks a try as failed when STRATZ fails or is cut off, and saves nothing", async () => {
  const failed = store();
  const outcome = await runFill(
    PLAYER,
    "welcome",
    failed,
    readDeps({ fetchStratzPage: () => Promise.reject(new Error("HTTP 502")) }),
  );
  assertEquals(outcome, { claimed: true, state: "waiting", added: 0 });
  assertEquals([failed.saves.length, failed.fails], [0, 1]);

  // A full first page and a failed second one: the older games would be missing.
  const partial = store({ fail: () => Promise.resolve("failed") });
  let calls = 0;
  const full = { player: { matches: Array.from({ length: 100 }, (_, i) => stratzMatch(i + 1, 1 + i * 0.1)) } };
  const outcome2 = await runFill(
    PLAYER,
    "welcome",
    partial,
    readDeps({ fetchStratzPage: () => calls++ === 0 ? Promise.resolve(full) : Promise.reject(new Error("timeout")) }),
  );
  assertEquals(outcome2, { claimed: true, state: "failed", added: 0 });
  assertEquals(partial.saves.length, 0);
});

Deno.test("without STRATZ, a failed OpenDota read is retried rather than saved as no games", async () => {
  const s = store();
  const outcome = await runFill(
    PLAYER,
    "welcome",
    s,
    readDeps({
      fetchStratzPage: () => Promise.resolve(null),
      fetchOpenDotaMatches: () => Promise.reject(new Error("HTTP 500")),
    }),
  );
  assertEquals(outcome.claimed && outcome.state, "waiting");
  assertEquals([s.saves.length, s.fails], [0, 1]);
});

Deno.test("a failed save counts as a failed try, and a failed fail mark still answers", async () => {
  const s = store({ save: () => Promise.reject(new Error("db down")) });
  assertEquals(await runFill(PLAYER, "welcome", s, readDeps()), { claimed: true, state: "waiting", added: 0 });
  assertEquals(s.fails, 1);

  const worse = store({
    save: () => Promise.reject(new Error("db down")),
    fail: () => Promise.reject(new Error("still down")),
  });
  const deps = readDeps();
  assertEquals(await runFill(PLAYER, "welcome", worse, deps), { claimed: true, state: "waiting", added: 0 });
  assertEquals(deps.logs.length, 2);
});

Deno.test("retries at most two due fills, and none when time runs short", async () => {
  const ran: string[] = [];
  const outcomes: Record<string, FillOutcome> = {
    a: { claimed: true, state: "done", added: 3 },
    b: { claimed: true, state: "waiting", added: 0 },
    c: { claimed: true, state: "done", added: 1 },
  };
  const run = (id: string) => {
    ran.push(id);
    return Promise.resolve(outcomes[id]);
  };
  const result = await retryDueFills(["a", "b", "c"], run, () => 45_000, () => {});
  assertEquals(ran.length, RETRY_FILLS_PER_RUN);
  assertEquals(result, { tried: 2, saved: 1, failed: 1 });

  ran.length = 0;
  assertEquals(await retryDueFills(["a"], run, () => RETRY_MIN_LEFT_MS - 1, () => {}), {
    tried: 0,
    saved: 0,
    failed: 0,
  });
  assertEquals(ran, []);
});

Deno.test("a retry that another run claimed first, or whose claim fails, is skipped", async () => {
  const logs: string[] = [];
  const result = await retryDueFills(
    ["a", "b"],
    (id) => id === "a" ? Promise.resolve({ claimed: false }) : Promise.reject(new Error("db down")),
    () => 45_000,
    (message) => logs.push(message),
  );
  assertEquals(result, { tried: 0, saved: 0, failed: 0 });
  assertEquals(logs.length, 1);
});
