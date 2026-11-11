import { assertEquals } from "jsr:@std/assert@1";
import { backfillPlan, type BackfillSnapshot, patchVersion, runBackfill } from "./backfill.ts";
import type { CachedSlice, LookupDeps } from "./lookup.ts";
import type { Slice } from "./queries.ts";

/** Seven heroes; 1 and 2 play carry (2 more often), 3 plays mid, 4 to 7 play nothing anywhere. */
const SNAPSHOT: BackfillSnapshot = {
  heroes: { 1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {}, 7: {} },
  itemTimings: {
    1: { 1: { all: { games: 100 } } },
    2: { 1: { all: { games: 500 } } },
    3: { 2: { all: { games: 50 } } },
  },
  skillBuilds: { 1: { 1: { gameVersionId: 184 } }, 2: { 1: { gameVersionId: 186 } } },
};

Deno.test("plans the most played heroes, positions taking turns, against every other hero five at a time", () => {
  const plan = backfillPlan(SNAPSHOT, 2);
  assertEquals(plan.map((s) => `${s.hero}@${s.position}:${s.enemies.join(",")}`), [
    "2@1:1,3,4,5,6",
    "2@1:7",
    "3@2:1,2,4,5,6",
    "3@2:7",
    "1@1:2,3,4,5,6",
    "1@1:7",
  ]);
  assertEquals(backfillPlan(SNAPSHOT, 1).map((s) => s.hero), [2, 2, 3, 3]);
  // A hero asked for first comes first and only once; an unknown hero is skipped.
  assertEquals(backfillPlan(SNAPSHOT, 1, [{ hero: 3, position: 2 }, { hero: 99, position: 1 }]).map((s) => s.hero), [
    3,
    3,
    2,
    2,
  ]);
});

Deno.test("sends the newest skill build version, as the site does", () => {
  assertEquals(patchVersion(SNAPSHOT), 186);
  assertEquals(patchVersion({ heroes: {} }), 0);
});

/** A lookup stand-in where every slice is already cached and fresh, unless `busy`. */
function deps(busy = false, cached = true): LookupDeps & { lookups: number } {
  const d = {
    lookups: 0,
    freeAt: () => Promise.resolve(busy ? new Date(Date.now() + 60_000).toISOString() : null),
    noteBusy: () => Promise.resolve(),
    readCache(heroes: number[], enemies: number[]): Promise<CachedSlice[]> {
      d.lookups++;
      if (busy || !cached) return Promise.resolve([]);
      const at = new Date().toISOString();
      // Every hero of the plan is cached at both positions it plays.
      return Promise.resolve(
        [1, 2].flatMap((position) =>
          enemies.map((enemy) => ({
            // A backfill lookup asks for one hero.
            hero: heroes[0]!,
            position,
            enemy,
            games: [],
            fetchedAt: at,
          }))
        ),
      );
    },
    takeLookup: () => Promise.resolve(true),
    claim: () => Promise.resolve([]),
    takeStratz: () => Promise.resolve(true),
    save: () => Promise.resolve(),
    post: () => Promise.reject(new Error("not used")),
    now: () => Date.now(),
  };
  return d;
}

Deno.test("runs the whole plan when nothing stops it", async () => {
  const d = deps();
  const done = await runBackfill(d, backfillPlan(SNAPSHOT, 2), 186, Date.now() + 60_000);
  assertEquals(done, { lookups: 6, fresh: 18, games: 0, failed: 0 });
});

Deno.test("stops at the first lookup STRATZ is busy for, and when the time is up", async () => {
  const busy = deps(true);
  assertEquals((await runBackfill(busy, backfillPlan(SNAPSHOT, 2), 186, Date.now() + 60_000)).stoppedBy, "stratz-busy");
  assertEquals(busy.lookups, 1);
  assertEquals((await runBackfill(deps(), backfillPlan(SNAPSHOT, 2), 186, Date.now() - 1)).lookups, 0);
});

Deno.test("skips a failing lookup, stops after three in a row, and stops when this hour's share is spent", async () => {
  const failing = { ...deps(false, false), claim: (s: Slice[]) => Promise.resolve(s) };
  const failed = await runBackfill(failing, backfillPlan(SNAPSHOT, 2), 186, Date.now() + 60_000);
  assertEquals([failed.lookups, failed.failed, failed.stoppedBy], [3, 3, "stratz-failed"]);
  const spent = { ...failing, takeStratz: () => Promise.resolve(false) };
  const done = await runBackfill(spent, backfillPlan(SNAPSHOT, 2), 186, Date.now() + 60_000);
  assertEquals([done.lookups, done.stoppedBy], [1, "stratz-budget"]);
});
