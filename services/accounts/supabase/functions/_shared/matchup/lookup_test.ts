import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { type CachedSlice, type LookupDeps, lookupMatchups, parseInput } from "./lookup.ts";
import type { MatchupGame, Slice } from "./queries.ts";
import { StratzBusy } from "./stratz.ts";

const NOW = Date.parse("2026-11-03T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const INPUT = { ours: [{ hero: 18, position: 1 }], theirs: [26, 5], version: 184 };

const game = (match: number, won: boolean): MatchupGame => ({
  match,
  account: match,
  won,
  level: 20,
  version: 184,
  points: [1, 2],
  items: [[1, 600]],
  duration: 1800,
  lead: [0, 200],
});

/** A STRATZ stand-in: Sven (18) at pos 1 against Lion (26) and Crystal Maiden (5). */
function stratzAnswer(query: string): Record<string, unknown> {
  if (query.includes("heroStats")) {
    return {
      w0: { guides: [{ matchId: 1 }] },
      l0: { guides: [{ matchId: 2 }] },
      w1: { guides: [{ matchId: 3 }] },
      l1: { guides: [] },
    };
  }
  const out: Record<string, unknown> = {};
  [...query.matchAll(/m(\d+): match\(id: (\d+)\)/g)].forEach(([, i, id]) => {
    const won = id !== "2";
    const enemy = id === "3" ? 5 : 26;
    out[`m${i}`] = {
      id: Number(id),
      gameVersionId: 184,
      durationSeconds: 1800,
      radiantNetworthLeads: [0, 200],
      players: [
        {
          steamAccountId: 40 + Number(id),
          heroId: 18,
          position: "POSITION_1",
          level: 20,
          isVictory: won,
          isRadiant: true,
          abilities: [],
          stats: { itemPurchases: [{ itemId: 1, time: 600 }] },
        },
        { steamAccountId: 9, heroId: enemy, position: "POSITION_5", level: 15, isVictory: !won, abilities: [] },
      ],
    };
  });
  return out;
}

function deps(over: Partial<LookupDeps> = {}, cache: CachedSlice[] = []) {
  const calls: string[] = [];
  const saved: Slice[] = [];
  const d: LookupDeps = {
    freeAt: () => (calls.push("free?"), Promise.resolve(null)),
    noteBusy: (until) => (calls.push(`busy until ${until - NOW}`), Promise.resolve()),
    readCache: () => Promise.resolve(cache),
    takeLookup: () => (calls.push("lookup"), Promise.resolve(true)),
    claim: (slices) => (calls.push(`claim ${slices.length}`), Promise.resolve(slices)),
    takeStratz: (n) => (calls.push(`stratz ${n}`), Promise.resolve(true)),
    save: (slices) => (saved.push(...slices), Promise.resolve()),
    post: <T>(query: string) => {
      calls.push("post");
      return Promise.resolve(stratzAnswer(query) as T);
    },
    now: () => NOW,
    ...over,
  };
  return { d, calls, saved };
}

Deno.test("fetches what the cache lacks, saves it and returns every slice", async () => {
  const { d, calls, saved } = deps();
  const result = await lookupMatchups(d, INPUT);
  assertEquals(calls, ["free?", "lookup", "claim 2", "stratz 3", "post", "post"]);
  assertEquals(saved.length, 2);
  assertEquals(result.pending, []);
  assertEquals(result.reasons, []);
  const lion = result.slices.find((s) => s.enemy === 26)!;
  assertEquals(lion.games.map((g) => [g.match, g.won]), [[1, true], [2, false]]);
  assertEquals(result.slices.find((s) => s.enemy === 5)!.games.map((g) => g.match), [3]);
});

Deno.test("answers from a fresh cache without asking STRATZ or taking a lookup", async () => {
  const fresh = (enemy: number): CachedSlice => ({
    hero: 18,
    position: 1,
    enemy,
    games: [game(7, true)],
    fetchedAt: new Date(NOW - DAY).toISOString(),
  });
  const { d, calls } = deps({}, [fresh(26), fresh(5)]);
  const result = await lookupMatchups(d, INPUT);
  assertEquals(calls, []);
  assertEquals(result.slices.map((s) => s.stale), [false, false]);
});

Deno.test("keeps stale cache when STRATZ fails, and says why", async () => {
  const old: CachedSlice = {
    hero: 18,
    position: 1,
    enemy: 26,
    games: [game(7, true)],
    fetchedAt: new Date(NOW - 10 * DAY).toISOString(),
  };
  const { d } = deps({ post: () => Promise.reject(new Error("down")) }, [old]);
  const result = await lookupMatchups(d, INPUT);
  assertEquals(result.slices.map((s) => [s.enemy, s.stale]), [[26, true]]);
  assertEquals(result.pending.map((s) => s.enemy), [5]);
  assertEquals(result.reasons, ["stratz-failed"]);
});

Deno.test("fails closed on the user limit and the STRATZ budget", async () => {
  const limited = await lookupMatchups(deps({ takeLookup: () => Promise.resolve(false) }).d, INPUT);
  assertEquals([limited.pending.length, limited.reasons], [2, ["user-limit"]]);
  const spent = deps({ takeStratz: () => Promise.resolve(false) });
  const budget = await lookupMatchups(spent.d, INPUT);
  assertEquals([budget.pending.length, budget.reasons], [2, ["stratz-budget"]]);
  assertEquals(spent.calls.includes("post"), false);
});

Deno.test("leaves slices another call is fetching as pending", async () => {
  const { d } = deps({ claim: (slices) => Promise.resolve(slices.slice(0, 1)) });
  const result = await lookupMatchups(d, INPUT);
  assertEquals(result.pending.map((s) => s.enemy), [5]);
  assertEquals(result.reasons, ["fetching-elsewhere"]);
});

Deno.test("doesn't save a slice whose matches didn't all answer in time", async () => {
  let clock = NOW;
  const { d, saved } = deps({
    now: () => clock,
    post: <T>(query: string) => {
      // The list query takes the whole budget, so no match query starts.
      clock += 9000;
      return Promise.resolve(stratzAnswer(query) as T);
    },
  });
  const result = await lookupMatchups(d, INPUT);
  assertEquals(saved, []);
  assertEquals(result.reasons, ["time"]);
  assertEquals(result.pending.length, 2);
});

Deno.test("checks the request", () => {
  assertEquals(parseInput(INPUT), INPUT);
  assertEquals(typeof parseInput(null), "string");
  assertEquals(typeof parseInput({ ...INPUT, theirs: [] }), "string");
  assertEquals(typeof parseInput({ ...INPUT, ours: [{ hero: 18, position: 6 }] }), "string");
  assertEquals(typeof parseInput({ ...INPUT, theirs: [18] }), "string");
  assertEquals(typeof parseInput({ ...INPUT, ours: [{ hero: 18, position: 1 }, { hero: 2, position: 1 }] }), "string");
  assertEquals(typeof parseInput({ ...INPUT, version: "184" }), "string");
  assertEquals(typeof parseInput({ ...INPUT, theirs: [1, 2, 3, 4, 5, 6] }), "string");
});

const iso = (ms: number) => new Date(ms).toISOString();
const MIN = 60 * 1000;
const fresh = INPUT.theirs.map((enemy) => ({
  hero: 18,
  position: 1,
  enemy,
  games: [game(enemy, true)],
  fetchedAt: iso(NOW - DAY),
}));

Deno.test("while STRATZ is held back nothing is taken or asked, and the answer says when to ask again", async () => {
  const { d, calls } = deps({ freeAt: () => Promise.resolve(iso(NOW + 15 * MIN)) });
  const out = await lookupMatchups(d, INPUT);
  assertEquals(calls, []);
  assertEquals(out.pending.length, 2);
  assertEquals(out.reasons, ["stratz-busy"]);
  assertEquals(out.retryAt, iso(NOW + 15 * MIN));
  assertEquals(out.retryIn, 15 * 60);
});

Deno.test("a fresh cache answers without asking whether STRATZ is free", async () => {
  const { d, calls } = deps({ freeAt: () => Promise.reject(new Error("not asked")) }, fresh);
  const out = await lookupMatchups(d, INPUT);
  assertEquals(calls, []);
  assertEquals(out.reasons, []);
  assertEquals(out.retryAt, undefined);
  assertEquals(out.slices.length, 2);
});

Deno.test("an error reading when STRATZ is free fails the lookup before anything is taken", async () => {
  const { d, calls } = deps({ freeAt: () => Promise.reject(new Error("db down")) });
  await assertRejects(() => lookupMatchups(d, INPUT), Error, "db down");
  assertEquals(calls, []);
});

Deno.test("a 429 answers stratz-busy with its wait and holds every lookup back", async () => {
  const { d, calls } = deps({ post: () => Promise.reject(new StratzBusy(2 * MIN)) });
  const out = await lookupMatchups(d, INPUT);
  assertEquals(out.reasons, ["stratz-busy"]);
  assertEquals(out.retryAt, iso(NOW + 2 * MIN));
  assertEquals(out.pending.length, 2);
  assertEquals(calls.at(-1), `busy until ${2 * MIN}`);
});

Deno.test("a 429 on a match query stops the other queries and saves nothing partial", async () => {
  let matchQueries = 0;
  const { d, saved } = deps({
    post: <T>(query: string) => {
      if (!query.includes("match(id:")) return Promise.resolve(stratzAnswer(query) as T);
      matchQueries++;
      return Promise.reject(new StratzBusy(MIN));
    },
  });
  const out = await lookupMatchups(d, INPUT);
  assertEquals(out.reasons, ["stratz-busy"]);
  assertEquals(out.retryAt, iso(NOW + MIN));
  assertEquals(saved, []);
  assertEquals(matchQueries, 1);
});

Deno.test("answers from a fresh row saved before the item fields without charging a lookup", async () => {
  const old = fresh.map((c) => ({ ...c, games: c.games.map(({ items: _i, duration: _d, lead: _l, ...g }) => g) }));
  const { d, calls } = deps({}, old);
  const out = await lookupMatchups(d, INPUT);
  assertEquals(calls.includes("lookup"), false);
  assertEquals(out.slices.map((s) => s.stale), [false, false]);
  assertEquals(out.slices.every((s) => s.games.every((g) => g.items === undefined)), true);
});

Deno.test("keeps a fresh row with no games fresh", async () => {
  const { d, calls } = deps({}, fresh.map((c) => ({ ...c, games: [] })));
  const out = await lookupMatchups(d, INPUT);
  assertEquals(calls.includes("lookup"), false);
  assertEquals(out.slices.map((s) => s.stale), [false, false]);
});
