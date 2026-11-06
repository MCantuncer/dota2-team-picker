import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { playerMatchesQuery, readStratzGames } from "./stratz.ts";

const NOW_S = 1_800_000_000;
const match = (id: number, over: Record<string, unknown> = {}, player: Record<string, unknown> = {}) => ({
  id,
  startDateTime: NOW_S - id * 3600,
  durationSeconds: 2400,
  gameMode: "ALL_PICK_RANKED",
  lobbyType: "RANKED",
  ...over,
  players: [{ heroId: 114, position: "POSITION_1", isVictory: true, imp: 31, leaverStatus: "NONE", ...player }],
});
const data = (...matches: unknown[]) => ({ player: { matches } });

Deno.test("the query asks for one player's own rows", () => {
  const q = playerMatchesQuery(1001);
  assertEquals(q.includes("player(steamAccountId: 1001)"), true);
  assertEquals(q.includes("players(steamAccountId: 1001)"), true);
  assertThrows(() => playerMatchesQuery(1.5));
  assertThrows(() => playerMatchesQuery(-1));
});

Deno.test("the query pages further back with take and skip", () => {
  assertEquals(playerMatchesQuery(1001).includes("take: 20, skip: 0"), true);
  assertEquals(playerMatchesQuery(1001, 100, 300).includes("take: 100, skip: 300"), true);
  assertThrows(() => playerMatchesQuery(1001, 101));
  assertThrows(() => playerMatchesQuery(1001, 100, -1));
});

Deno.test("reads games inside a longer window when asked", () => {
  const old = data(match(24 * 100));
  assertEquals(readStratzGames(old, NOW_S).length, 0);
  assertEquals(readStratzGames(old, NOW_S, 180).length, 1);
});

Deno.test("reads position, result and IMP", () => {
  assertEquals(readStratzGames(data(match(1)), NOW_S), [
    { matchId: 1, heroId: 114, startTime: NOW_S - 3600, isWin: true, position: 1, imp: 31, gameMode: 22, lobbyType: 7 },
  ]);
  assertEquals(readStratzGames(data(match(2, {}, { position: "UNKNOWN", imp: null })), NOW_S)[0]?.position, null);
  assertEquals(readStratzGames(data(match(2, {}, { position: "UNKNOWN", imp: null })), NOW_S)[0]?.imp, null);
});

Deno.test("keeps counted games only", () => {
  const games = readStratzGames(
    data(
      match(1),
      match(2, { gameMode: "TURBO" }),
      match(3, { lobbyType: "PRACTICE" }),
      match(4, { durationSeconds: 300 }),
      match(5, {}, { leaverStatus: "ABANDONED" }),
      match(24 * 31),
      match(6, { gameMode: "ALL_PICK", lobbyType: "UNRANKED" }),
    ),
    NOW_S,
  );
  assertEquals(games.map((g) => g.matchId), [1, 6]);
});

Deno.test("odd answers give no games instead of throwing", () => {
  assertEquals(readStratzGames(null, NOW_S), []);
  assertEquals(readStratzGames({ player: null }, NOW_S), []);
  assertEquals(
    readStratzGames(data(null, { id: "x" }, match(1, {}, { heroId: 0 }), { ...match(2), players: [] }), NOW_S),
    [],
  );
});
