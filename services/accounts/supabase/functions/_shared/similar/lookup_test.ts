import { assertEquals } from "jsr:@std/assert@1";
import { lookupSimilar, parseSimilarInput, RETRY_SOON_S, type SimilarDeps, type SimilarInput } from "./lookup.ts";
import { readDetails, type SimilarMatch } from "./details.ts";
import { type HeroSearch, readSearch } from "./search.ts";
import { StratzBusy } from "../matchup/stratz.ts";

const searchFixture = JSON.parse(await Deno.readTextFile(new URL("./fixtures/search-answer.json", import.meta.url)));
const stratzFixture = JSON.parse(await Deno.readTextFile(new URL("./fixtures/stratz-matches.json", import.meta.url)));
const INVOKER = 74;
const REAL_MATCH = 9099898435;
const NOT_ON_STRATZ = 1;
const NOW = Date.parse("2026-11-22T15:00:00Z");
const PATCH_START = searchFixture.input.patchStart;

const input: SimilarInput = {
  ours: [{ hero: INVOKER, position: 2 }, { hero: 8, position: 1 }, { hero: 128, position: 3 }, {
    hero: 129,
    position: 4,
  }, { hero: 5, position: 5 }],
  enemies: searchFixture.input.enemies,
  heroes: [INVOKER],
};

/** Invoker's real search, cut to the real match STRATZ has and one it can't give. */
function invokerSearch(): HeroSearch[] {
  const invoker = readSearch(searchFixture.rows, searchFixture.input.ours)[0];
  const real = invoker.games.find((g) => g.match === REAL_MATCH)!; // In the fixture.
  return [{ ...invoker, games: [real, { ...real, match: NOT_ON_STRATZ }] }];
}

/** Stand-ins that answer like a quiet day, and log every call that spends or claims something. */
function fakeDeps(over: Partial<SimilarDeps> = {}) {
  const calls: string[] = [];
  const deps: SimilarDeps = {
    now: () => NOW,
    readSearch: () => Promise.resolve(null),
    saveSearch: (key) => (calls.push(`saveSearch ${key.split(":")[0]}`), Promise.resolve()),
    claim: (keys) => (calls.push(`claim ${keys.join(",")}`), Promise.resolve(keys)),
    release: (keys) => (calls.push(`release ${keys.join(",")}`), Promise.resolve()),
    takeLookup: () => (calls.push("takeLookup"), Promise.resolve(true)),
    takeOpenDota: () => (calls.push("takeOpenDota"), Promise.resolve(true)),
    search: () => (calls.push("search"), Promise.resolve(invokerSearch())),
    readMatches: () => Promise.resolve(new Map()),
    saveMatches: (read, unreadable) => (
      calls.push(`saveMatches ${read.map((m) => m.match).join(",")} / ${unreadable.join(",")}`), Promise.resolve()
    ),
    stratzFreeAt: () => Promise.resolve(null),
    noteBusy: (until) => (calls.push(`noteBusy ${until - NOW}`), Promise.resolve()),
    takeStratz: (n) => (calls.push(`takeStratz ${n}`), Promise.resolve(true)),
    // Only the real match comes back, as STRATZ does for a match it can't give.
    post: <T>() => (calls.push("post"), Promise.resolve(stratzFixture.data as T)),
    ...over,
  };
  return { deps, calls };
}

const fresh = () => Promise.resolve({ heroes: invokerSearch(), fetchedAt: new Date(NOW - 60_000).toISOString() });
const both = () =>
  Promise.resolve(
    new Map<number, SimilarMatch | null>([[REAL_MATCH, readDetails(stratzFixture.data)[0]], [NOT_ON_STRATZ, null]]),
  );

Deno.test("answers from the caches without spending anything", async () => {
  const { deps, calls } = fakeDeps({ readSearch: fresh, readMatches: both });
  const result = await lookupSimilar(deps, input, PATCH_START);
  assertEquals(calls, []);
  assertEquals(result.reasons, []);
  const [invoker] = result.heroes;
  assertEquals([invoker.hero, invoker.level, invoker.pending], [INVOKER, 3, false]);
  assertEquals(invoker.games.map((g) => g.match), [REAL_MATCH]);
  // Every role at 3 or more shared enemies: levels 3, 4 and 5 of the real answer.
  const levels = invokerSearch()[0].levels;
  assertEquals(invoker.found, levels[3].games + levels[4].games + levels[5].games);
});

Deno.test("searches once, then reads the missing matches from STRATZ and stores what it can't give", async () => {
  const { deps, calls } = fakeDeps();
  const result = await lookupSimilar(deps, input, PATCH_START);
  assertEquals(calls, [
    `claim s:1:${PATCH_START}:5,8,74,128,129:${[...input.enemies].sort((a, b) => a - b).join(",")}`,
    "takeLookup",
    "takeOpenDota",
    "search",
    "saveSearch 1",
    `release s:1:${PATCH_START}:5,8,74,128,129:${[...input.enemies].sort((a, b) => a - b).join(",")}`,
    `claim m:${REAL_MATCH},m:${NOT_ON_STRATZ}`,
    "takeStratz 1",
    "post",
    `saveMatches ${REAL_MATCH} / ${NOT_ON_STRATZ}`,
    `release m:${REAL_MATCH},m:${NOT_ON_STRATZ}`,
  ]);
  assertEquals(result.reasons, []);
  assertEquals(result.heroes[0].games.map((g) => g.match), [REAL_MATCH]);
  assertEquals(result.heroes[0].pending, false);
  assertEquals(result.retryIn, undefined);
});

Deno.test("while another call searches the same draft, says to ask again soon", async () => {
  const { deps, calls } = fakeDeps({ claim: () => Promise.resolve([]) });
  const result = await lookupSimilar(deps, input, PATCH_START);
  assertEquals(calls, []);
  assertEquals(result, { heroes: [], reasons: ["searching-elsewhere"], retryIn: RETRY_SOON_S });
});

Deno.test("a user out of lookups or a spent OpenDota budget gets no search, and the claim is let go", async () => {
  const outOfLookups = fakeDeps({ takeLookup: () => Promise.resolve(false) });
  const a = await lookupSimilar(outOfLookups.deps, input, PATCH_START);
  assertEquals(a, { heroes: [], reasons: ["user-limit"] });
  assertEquals(outOfLookups.calls.filter((c) => c.startsWith("release")).length, 1);

  const spent = fakeDeps({ takeOpenDota: () => Promise.resolve(false) });
  const b = await lookupSimilar(spent.deps, input, PATCH_START);
  assertEquals(b, { heroes: [], reasons: ["budget"] });
  assertEquals(spent.calls.includes("search"), false);
  assertEquals(spent.calls.filter((c) => c.startsWith("release")).length, 1);
});

Deno.test("a failed search is not saved, and the claim is let go", async () => {
  const { deps, calls } = fakeDeps({ search: () => Promise.reject(new Error("explorer down")) });
  const result = await lookupSimilar(deps, input, PATCH_START);
  assertEquals(result, { heroes: [], reasons: ["failed"] });
  assertEquals(calls.some((c) => c.startsWith("saveSearch")), false);
  assertEquals(calls.at(-1)?.startsWith("release s:"), true);
});

Deno.test("while STRATZ is busy, answers what is stored as pending, with when to ask again", async () => {
  const { deps, calls } = fakeDeps({
    readSearch: fresh,
    stratzFreeAt: () => Promise.resolve(new Date(NOW + 90_000).toISOString()),
  });
  const result = await lookupSimilar(deps, input, PATCH_START);
  assertEquals(calls, []);
  assertEquals(result.reasons, ["stratz-busy"]);
  assertEquals(result.retryIn, 90);
  assertEquals([result.heroes[0].games.length, result.heroes[0].pending], [0, true]);
});

Deno.test("a STRATZ refusal is noted for every lookup, and the matches are let go", async () => {
  const { deps, calls } = fakeDeps({
    readSearch: fresh,
    post: () => (Promise.reject(new StratzBusy(120_000))),
  });
  const result = await lookupSimilar(deps, input, PATCH_START);
  assertEquals(calls.includes("noteBusy 120000"), true);
  assertEquals(calls.at(-1), `release m:${REAL_MATCH},m:${NOT_ON_STRATZ}`);
  assertEquals(calls.some((c) => c.startsWith("saveMatches")), false);
  assertEquals([result.reasons, result.retryIn, result.heroes[0].pending], [["stratz-busy"], 120, true]);
});

Deno.test("an empty STRATZ budget stops before any query", async () => {
  const { deps, calls } = fakeDeps({ readSearch: fresh, takeStratz: () => Promise.resolve(false) });
  const result = await lookupSimilar(deps, input, PATCH_START);
  assertEquals(calls.includes("post"), false);
  assertEquals(calls.at(-1), `release m:${REAL_MATCH},m:${NOT_ON_STRATZ}`);
  assertEquals([result.reasons, result.heroes[0].pending], [["budget"], true]);
});

Deno.test("checks the request body", () => {
  const body = { ours: input.ours, enemies: input.enemies, heroes: [INVOKER, INVOKER] };
  assertEquals(parseSimilarInput(body), { ...input, heroes: [INVOKER] });
  assertEquals(parseSimilarInput(null), "Send ours, enemies and heroes");
  assertEquals(parseSimilarInput({ ...body, enemies: input.enemies.slice(1) }), "Send five heroes a side");
  assertEquals(
    parseSimilarInput({ ...body, enemies: [...input.enemies.slice(1), INVOKER] }),
    "A hero can be picked once",
  );
  const samePosition = input.ours.map((o) => ({ ...o, position: 1 }));
  assertEquals(parseSimilarInput({ ...body, ours: samePosition }), "Each position once");
  assertEquals(parseSimilarInput({ ...body, heroes: [input.enemies[0]] }), "Ask for our own heroes");
  assertEquals(
    parseSimilarInput({ ...body, ours: [{ hero: INVOKER, position: 6 }, ...input.ours.slice(1)] }),
    "Each of our heroes needs a hero id and a position 1 to 5",
  );
});
