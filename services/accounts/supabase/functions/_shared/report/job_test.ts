import { assertEquals } from "jsr:@std/assert@1";
import type { FoundMatch } from "../attach.ts";
import { type ClaimedReport, OpenDotaBusy, type ReportUpdate } from "./build.ts";
import { type JobDeps, runJob, type UnattachedDraft } from "./job.ts";

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
  const seen = { taken: [] as number[], saved: [] as string[], logged: [] as string[] };
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
    log: (message) => seen.logged.push(message),
    ...over,
  };
  return { deps, seen };
}

Deno.test("a run finds matches, then builds and saves the due reports", async () => {
  const { deps, seen } = fakes();
  assertEquals(await runJob(deps), { attached: 1, built: 2, calls: 10, stopped: null });
  assertEquals(seen.taken, [3, 3, 2, 2], "each search takes one call per player plus the match");
  assertEquals(seen.saved, ["r1", "r2"]);
});

Deno.test("a match someone else attached first is not counted", async () => {
  const { deps } = fakes({ attach: () => Promise.resolve(false) });
  assertEquals((await runJob(deps)).attached, 0);
});

Deno.test("the run stops at its own call cap", async () => {
  const { deps, seen } = fakes();
  assertEquals(await runJob(deps, 7), { attached: 1, built: 0, calls: 6, stopped: "run cap" });
  assertEquals(seen.saved, []);
});

Deno.test("the run stops when the daily budget refuses", async () => {
  const { deps, seen } = fakes({ takeCalls: (n) => Promise.resolve(n === 3) });
  assertEquals(await runJob(deps), { attached: 1, built: 0, calls: 6, stopped: "daily budget" });
  assertEquals(seen.saved, []);
});

Deno.test("OpenDota rate limiting stops the run at once", async () => {
  const { deps } = fakes({ findMatch: () => Promise.reject(new OpenDotaBusy()) });
  assertEquals((await runJob(deps)).stopped, "rate limit");
  const building = fakes({ build: () => Promise.reject(new OpenDotaBusy()) });
  assertEquals(await runJob(building.deps), { attached: 1, built: 0, calls: 8, stopped: "rate limit" });
});

Deno.test("one draft's or report's error is logged and the run goes on", async () => {
  const { deps, seen } = fakes({
    attach: () => Promise.reject(new Error("db down")),
    save: (id) => (id === "r1" ? Promise.reject(new Error("db down")) : Promise.resolve()),
  });
  assertEquals(await runJob(deps), { attached: 0, built: 1, calls: 10, stopped: null });
  assertEquals(seen.logged, ["Finding the match of draft a failed", "Saving the report of draft r1 failed"]);
});
