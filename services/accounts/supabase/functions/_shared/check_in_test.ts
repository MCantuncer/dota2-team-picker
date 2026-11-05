import { assertEquals } from "jsr:@std/assert@1";
import { findCheckInMatch, type SoloCheckIn } from "./check_in.ts";
import type { MatchDetails } from "./match.ts";

const started = "2026-11-05T10:00:00Z";
const t = (minutes: number) => Date.parse(started) / 1000 + minutes * 60;
const board: SoloCheckIn = { id: "b", account_id: 7, allies: [1, 2, 3, 4, 5], my_hero: 2, started_at: started };

/** A finished match with our five on Radiant (or only some of them) against five others. */
const match = (id: number, radiant: number[]): MatchDetails =>
  ({
    match_id: id,
    radiant_win: true,
    players: [
      ...radiant.map((hero_id, i) => ({ player_slot: i, hero_id, account_id: i === 1 ? 7 : null })),
      ...[6, 7, 8, 9, 10].map((hero_id, i) => ({ player_slot: 128 + i, hero_id, account_id: null })),
    ],
  }) as MatchDetails;

const recentGame = (match_id: number, hero_id: number, minutes: number) => ({
  match_id,
  hero_id,
  start_time: t(minutes),
  player_slot: 1,
  radiant_win: true,
});

Deno.test("a practice draft's wrong first game is skipped for the next one that fits", async () => {
  const matches: Record<number, MatchDetails> = { 11: match(11, [2, 20, 21, 22, 23]), 12: match(12, [1, 2, 3, 4, 5]) };
  const fetched: number[] = [];
  const find = await findCheckInMatch({
    fetchRecentMatches: () => Promise.resolve([recentGame(12, 2, 50), recentGame(11, 2, 2), recentGame(10, 2, -60)]),
    fetchMatch: (id) => {
      fetched.push(id);
      return Promise.resolve(matches[id] ?? null);
    },
  }, board);
  assertEquals(find.kind, "found");
  assertEquals(find.kind === "found" && find.found.side, { matchId: 12, won: true, isRadiant: true });
  assertEquals(fetched, [11, 12], "games from before the start are never fetched");
});

Deno.test("only games on the player's own hero count when they picked one", async () => {
  const fetched: number[] = [];
  const find = await findCheckInMatch({
    fetchRecentMatches: () => Promise.resolve([recentGame(13, 1, 5)]),
    fetchMatch: (id) => {
      fetched.push(id);
      return Promise.resolve(null);
    },
  }, board);
  assertEquals(find, { kind: "not found" });
  assertEquals(fetched, []);
});

Deno.test("no recent games at all is told apart from no matching game", async () => {
  const find = await findCheckInMatch({
    fetchRecentMatches: () => Promise.resolve([]),
    fetchMatch: () => Promise.reject(new Error("not called")),
  }, board);
  assertEquals(find, { kind: "no games" });
});
