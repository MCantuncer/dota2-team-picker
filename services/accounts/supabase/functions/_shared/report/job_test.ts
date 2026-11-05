import { assertEquals } from "jsr:@std/assert@1";
import type { FoundMatch } from "../attach.ts";
import { type ClaimedReport, OpenDotaBusy, type ReportUpdate } from "./build.ts";
import type { CheckInFind, SoloCheckIn } from "../check_in.ts";
import { CHECK_IN_RUN_CALLS, type JobDeps, runJob, type UnattachedDraft } from "./job.ts";

const draft = (id: string, accounts = 2): UnattachedDraft => ({
  draft_id: id,
  created_at: "2026-11-02T10:00:00Z",
  allies: [1, 2],
  account_ids: Array.from({ length: accounts }, (_, i) => 1000 + i),
});
const report = (id: string) => ({ draft_id: id }) as ClaimedReport;
const found = { side: { matchId: 1 } } as FoundMatch;
const update = { status: "ready" } as ReportUpdate;

function fakes(over: Partial<JobDeps> = {}) {
  const seen = { taken: [] as number[], saved: [] as string[], logged: [] as string[], noGames: [] as string[] };
  const deps: JobDeps = {
    takeCalls: (n) => {
      seen.taken.push(n);
      return Promise.resolve(true);
    },
    claimDrafts: () => Promise.resolve([draft("a"), draft("b")]),
    findMatch: (d) => Promise.resolve(d.draft_id === "a" ? found : null),
    attach: () => Promise.resolve(true),
    claimReports: () => Promise.resolve([report("r1"), report("r2")]),
    build: () => Promise.resolve(update),
    save: (id) => {
      seen.saved.push(id);
      return Promise.resolve();
    },
    claimCheckIns: () => Promise.resolve([]),
    findCheckIn: () => Promise.resolve({ kind: "not found" }),
    saveCheckIn: () => Promise.resolve(true),
    noteNoGames: (id) => {
      seen.noGames.push(id);
      return Promise.resolve();
    },
    cleanFiles: () => Promise.resolve(0),
    forgetCheckIns: () => Promise.resolve(0),
    log: (message) => seen.logged.push(message),
    ...over,
  };
  return { deps, seen };
}

Deno.test("a run finds matches, then builds and saves the due reports", async () => {
  const { deps, seen } = fakes();
  assertEquals(await runJob(deps), {
    attached: 1,
    built: 2,
    checkIns: 0,
    removedFiles: 0,
    removedCheckIns: 0,
    calls: 10,
    stopped: null,
  });
  assertEquals(seen.taken, [3, 3, 2, 2], "each search takes one call per player plus the match");
  assertEquals(seen.saved, ["r1", "r2"]);
});

Deno.test("a match someone else attached first is not counted", async () => {
  const { deps } = fakes({ attach: () => Promise.resolve(false) });
  assertEquals((await runJob(deps)).attached, 0);
});

Deno.test("the run stops at its own call cap", async () => {
  const { deps, seen } = fakes();
  assertEquals(await runJob(deps, 7), {
    attached: 1,
    built: 0,
    checkIns: 0,
    removedFiles: 0,
    removedCheckIns: 0,
    calls: 6,
    stopped: "run cap",
  });
  assertEquals(seen.saved, []);
});

Deno.test("the run stops when the daily budget refuses", async () => {
  const { deps, seen } = fakes({ takeCalls: (n) => Promise.resolve(n === 3) });
  assertEquals(await runJob(deps), {
    attached: 1,
    built: 0,
    checkIns: 0,
    removedFiles: 0,
    removedCheckIns: 0,
    calls: 6,
    stopped: "daily budget",
  });
  assertEquals(seen.saved, []);
});

Deno.test("OpenDota rate limiting stops the run at once", async () => {
  const { deps } = fakes({ findMatch: () => Promise.reject(new OpenDotaBusy()) });
  assertEquals((await runJob(deps)).stopped, "rate limit");
  const building = fakes({ build: () => Promise.reject(new OpenDotaBusy()) });
  assertEquals(await runJob(building.deps), {
    attached: 1,
    built: 0,
    checkIns: 0,
    removedFiles: 0,
    removedCheckIns: 0,
    calls: 8,
    stopped: "rate limit",
  });
});

Deno.test("one draft's or report's error is logged and the run goes on", async () => {
  const { deps, seen } = fakes({
    attach: () => Promise.reject(new Error("db down")),
    save: (id) => (id === "r1" ? Promise.reject(new Error("db down")) : Promise.resolve()),
  });
  assertEquals(await runJob(deps), {
    attached: 0,
    built: 1,
    checkIns: 0,
    removedFiles: 0,
    removedCheckIns: 0,
    calls: 10,
    stopped: null,
  });
  assertEquals(seen.logged, ["Finding the match of draft a failed", "Saving the report of draft r1 failed"]);
});

Deno.test("old saved matches are deleted every run, even one stopped early", async () => {
  const { deps } = fakes({ cleanFiles: () => Promise.resolve(3), findMatch: () => Promise.reject(new OpenDotaBusy()) });
  assertEquals(await runJob(deps), {
    attached: 0,
    built: 0,
    checkIns: 0,
    removedFiles: 3,
    removedCheckIns: 0,
    calls: 3,
    stopped: "rate limit",
  });
  const failing = fakes({ cleanFiles: () => Promise.reject(new Error("storage down")) });
  assertEquals((await runJob(failing.deps)).built, 2);
  assertEquals(failing.seen.logged, ["Deleting old saved matches failed"]);
});

const board = (id: string): SoloCheckIn => ({
  id,
  account_id: 1000,
  allies: [1, 2, 3, 4, 5],
  my_hero: 2,
  started_at: "2026-11-05T10:00:00Z",
});

Deno.test("after the reports, the run looks for started solo games within its own share", async () => {
  const finds: Record<string, CheckInFind> = { s1: { kind: "found", found }, s2: { kind: "no games" } };
  const { deps, seen } = fakes({
    claimCheckIns: () => Promise.resolve([board("s1"), board("s2"), board("s3")]),
    findCheckIn: (b) => Promise.resolve(finds[b.id] ?? { kind: "not found" }),
    forgetCheckIns: () => Promise.resolve(4),
  });
  const result = await runJob(deps);
  assertEquals(result.checkIns, 1);
  assertEquals(result.removedCheckIns, 4);
  assertEquals(seen.noGames, ["s2"], "an empty search is noted");
  assertEquals(seen.taken, [3, 3, 2, 2, 4, 4], "two boards fit the check-in share, the third waits");
  assertEquals(result.calls, 10 + CHECK_IN_RUN_CALLS);
});

Deno.test("check-ins still run when the reports hit the run cap, but not when the budget is gone", async () => {
  const capped = fakes({ claimCheckIns: () => Promise.resolve([board("s1")]) });
  assertEquals((await runJob(capped.deps, 7)).calls, 6 + 4);
  const broke = fakes({
    takeCalls: () => Promise.resolve(false),
    claimCheckIns: () => Promise.reject(new Error("never claimed")),
  });
  assertEquals((await runJob(broke.deps)).stopped, "daily budget");
  assertEquals(broke.seen.logged, []);
});

Deno.test("a rate limit while looking for a solo game stops the check-ins", async () => {
  const { deps } = fakes({
    claimCheckIns: () => Promise.resolve([board("s1"), board("s2")]),
    findCheckIn: () => Promise.reject(new OpenDotaBusy()),
  });
  const result = await runJob(deps);
  assertEquals(result.stopped, "rate limit");
  assertEquals(result.calls, 10 + 4);
});
