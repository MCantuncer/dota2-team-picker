import { assertEquals } from "jsr:@std/assert@1";
import { GAMES_PER_ACCOUNT, MAX_CANDIDATES, pickGames, ROLE_GOAL, toSimilarGame } from "./answer.ts";
import { readDetails, type SimilarMatch } from "./details.ts";
import { type HeroSearch, readSearch, type SearchGame } from "./search.ts";

const searchFixture = JSON.parse(await Deno.readTextFile(new URL("./fixtures/search-answer.json", import.meta.url)));
const stratzFixture = JSON.parse(await Deno.readTextFile(new URL("./fixtures/stratz-matches.json", import.meta.url)));
const INVOKER = 74;

Deno.test("joins a real search game and its real STRATZ match into the game the browser gets", () => {
  const invoker = readSearch(searchFixture.rows, searchFixture.input.ours)[0];
  const [match] = readDetails(stratzFixture.data);
  const found = invoker.games.find((g) => g.match === match.match)!; // 9099898435 is in both fixtures.
  const game = toSimilarGame(match, found, INVOKER)!; // Invoker played it.
  assertEquals([game.won, game.sharedEnemies, game.sharedAllies, game.position], [true, 4, 1, 2]);
  assertEquals(game.allies.length, 5);
  assertEquals(game.allies.some((s) => s.hero === INVOKER), true);
  // The search said which enemies were there; STRATZ agrees.
  assertEquals(game.enemies.map((s) => s.hero).sort((a, b) => a - b), [...found.enemies].sort((a, b) => a - b));
  // No account goes to the browser.
  assertEquals("account" in game, false);
  assertEquals(toSimilarGame(match, found, 1), null);
});

let nextId = 1;
function found(): SearchGame {
  const match = nextId++;
  return {
    match,
    won: true,
    startTime: 1795040000,
    duration: 2000,
    sharedEnemies: 3,
    sharedAllies: 0,
    enemies: [11, 14, 26, 2, 44],
    allies: [INVOKER, 8, 9, 10, 12],
  };
}

function stored(g: SearchGame, position: number, account: number | null = g.match): SimilarMatch {
  const player = (hero: number, radiant: boolean, i: number) => ({
    hero,
    radiant,
    position: hero === INVOKER ? position : (i % 5) + 1,
    lane: null,
    account: hero === INVOKER ? account : null,
    kills: 1,
    deaths: 1,
    assists: 1,
    networth: 1,
    lastHits10: null,
    buys: [],
    deathsAt: [],
  });
  return {
    version: 1,
    match: g.match,
    duration: g.duration,
    radiantWon: true,
    players: [...g.allies.map((h, i) => player(h, true, i)), ...g.enemies.map((h, i) => player(h, false, i))],
  };
}

const search = (games: SearchGame[]): HeroSearch => ({ hero: INVOKER, levels: [], level: 3, games });

Deno.test("picks role games in order, skips other roles and unreadable matches, lists what to fetch", () => {
  const games = Array.from({ length: 6 }, found);
  const map = new Map<number, SimilarMatch | null>([
    [games[0].match, stored(games[0], 2)],
    [games[1].match, stored(games[1], 4)],
    [games[3].match, null],
    [games[4].match, stored(games[4], 2)],
  ]);
  const pick = pickGames(search(games), 2, map);
  assertEquals(pick.games.map((g) => g.match), [games[0].match, games[4].match]);
  assertEquals(pick.missing, [games[2].match, games[5].match]);
});

Deno.test("stops at the goal and allows few games per account", () => {
  const games = Array.from({ length: ROLE_GOAL + 5 }, found);
  const all = new Map<number, SimilarMatch | null>(games.map((g) => [g.match, stored(g, 2)]));
  const pick = pickGames(search(games), 2, all);
  assertEquals(pick.games.length, ROLE_GOAL);
  assertEquals(pick.missing, []);
  // One player in every game: only his first few count. Anonymous players each count.
  const one = new Map<number, SimilarMatch | null>(games.map((g) => [g.match, stored(g, 2, 42)]));
  assertEquals(pickGames(search(games), 2, one).games.length, GAMES_PER_ACCOUNT);
  const anonymous = new Map<number, SimilarMatch | null>(games.map((g) => [g.match, stored(g, 2, null)]));
  assertEquals(pickGames(search(games), 2, anonymous).games.length, ROLE_GOAL);
});

Deno.test("reads no further than the most similar games", () => {
  const games = Array.from({ length: MAX_CANDIDATES + 10 }, found);
  assertEquals(pickGames(search(games), 2, new Map()).missing.length, MAX_CANDIDATES);
});
