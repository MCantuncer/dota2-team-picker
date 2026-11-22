import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import {
  checkSearchInput,
  GAMES_PER_HERO,
  MIN_GAMES,
  readSearch,
  searchGames,
  searchKey,
  searchSql,
} from "./search.ts";

const fixture = JSON.parse(await Deno.readTextFile(new URL("./fixtures/search-answer.json", import.meta.url)));
const INPUT = { ours: [74, 8, 128, 129, 5], enemies: [11, 14, 26, 2, 44], patchStart: 1795037287 };
const NOW = 1795350000;

Deno.test("reads a real explorer answer into one search per hero, in our order", () => {
  const searches = readSearch(fixture.rows, INPUT.ours);
  assertEquals(searches.map((s) => s.hero), INPUT.ours);
  const invoker = searches[0];
  assertEquals(invoker.level, 3);
  assertEquals(invoker.levels[3], { games: 140, wins: 81 });
  assertEquals(invoker.levels[4], { games: 5, wins: 5 });
  // Most similar first: 4 shared enemies before 3.
  assertEquals(invoker.games[0].sharedEnemies, 4);
  assertEquals(invoker.games.every((g) => g.allies.includes(74) && g.enemies.length === 5), true);
  assertEquals(searches.every((s) => s.games.every((g) => g.sharedEnemies >= 3)), true);
});

Deno.test("falls back to 2 shared enemies, then to no games", () => {
  const level = (se: number, games: number) => ({ kind: "level", hero: 74, se, games, wins: 0 });
  const game = (se: number, match: number) => ({
    kind: "game",
    hero: 74,
    se,
    sa: 0,
    games: 1,
    wins: 1,
    match_id: String(match),
    start_time: NOW,
    duration: 1800,
    enemy: [1, 2, 3, 4, 6],
    ally: [74, 7, 9, 10, 12],
  });
  const ours = [74, 8, 128, 129, 5];
  const two = readSearch([level(3, MIN_GAMES - 1), level(2, 1), game(2, 10), game(3, 11)], ours)[0];
  assertEquals(two.level, 2);
  assertEquals(two.games.map((g) => g.match), [11, 10]);
  const none = readSearch([level(3, 5), level(2, MIN_GAMES - 6), game(2, 10)], ours)[0];
  assertEquals(none.level, null);
  assertEquals(none.games, []);
  // A hero with no games at all is there with zeros.
  assertEquals(readSearch([], ours)[4].levels.every((l) => l.games === 0), true);
});

Deno.test("throws on rows it can't read, so a changed answer never gives wrong counts", () => {
  const ours = [74, 8, 128, 129, 5];
  assertThrows(() => readSearch(null, ours));
  assertThrows(() => readSearch([{ kind: "level", hero: 99, se: 3, games: 1, wins: 0 }], ours));
  assertThrows(() => readSearch([{ kind: "level", hero: 74, se: 3, games: 1, wins: 2 }], ours));
  assertThrows(() => readSearch([{ kind: "other", hero: 74, se: 3 }], ours));
  const bad = { ...fixture.rows.find((r: { kind: string }) => r.kind === "game"), ally: [1, 2, 3, 4, 6] };
  assertThrows(() => readSearch([bad], ours), Error, "Bad game row");
});

Deno.test("builds the SQL only from checked input", () => {
  checkSearchInput(INPUT, NOW);
  const sql = searchSql(INPUT);
  assertEquals(sql.includes("start_time >= 1795037287 and lobby_type = 7 and game_mode = 22"), true);
  assertEquals(sql.includes("avg_rank_tier >= 70"), true);
  assertEquals(sql.includes("values (74),(8),(128),(129),(5)"), true);
  assertEquals(sql.includes(`n <= ${GAMES_PER_HERO}`), true);
  assertThrows(() => checkSearchInput({ ...INPUT, ours: [74, 8, 128, 129] }, NOW));
  assertThrows(() => checkSearchInput({ ...INPUT, enemies: [11, 14, 26, 2, 74] }, NOW));
  assertThrows(() => checkSearchInput({ ...INPUT, ours: [74, 8, 128, 129, 1.5] }, NOW));
  assertThrows(() => checkSearchInput({ ...INPUT, patchStart: NOW + 1 }, NOW));
  assertThrows(() => checkSearchInput({ ...INPUT, patchStart: NOW - 200 * 86400 }, NOW));
  // A string where a number belongs, as a bad caller could send.
  assertThrows(() => checkSearchInput({ ...INPUT, patchStart: "1; drop table x" as unknown as number }, NOW));
});

Deno.test("keys a search by rules, patch and both teams, whatever the order", () => {
  const key = searchKey(INPUT);
  assertEquals(key, "1:1795037287:5,8,74,128,129:2,11,14,26,44");
  assertEquals(searchKey({ ...INPUT, ours: [...INPUT.ours].reverse() }), key);
});

Deno.test("fails closed on explorer errors", async () => {
  const answer = (status: number, body: unknown): typeof fetch => () =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));
  await assertRejects(() => searchGames(INPUT, NOW, answer(200, { err: "statement timeout" })), Error, "timeout");
  await assertRejects(() => searchGames(INPUT, NOW, answer(500, {})), Error, "HTTP 500");
  const ok = await searchGames(INPUT, NOW, answer(200, { rows: fixture.rows }));
  assertEquals(ok[0].level, 3);
});
