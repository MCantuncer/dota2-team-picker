import { assertEquals } from "jsr:@std/assert@1";
import { isCountedGame, positionFromLane, readRecentMatch, type RecentMatch, statValuesOf } from "./games.ts";

const NOW_S = Date.parse("2026-11-02T12:00:00Z") / 1000;
const DAY_S = 86_400;

/** A recentMatches row as OpenDota sends it (fields checked live 2026-11-02). */
const row = (over: Record<string, unknown> = {}) => ({
  match_id: 8138048280,
  player_slot: 2,
  radiant_win: true,
  hero_id: 114,
  start_time: NOW_S - DAY_S,
  duration: 2400,
  game_mode: 22,
  lobby_type: 7,
  leaver_status: 0,
  lane_role: 1,
  is_roaming: false,
  last_hits: 280,
  gold_per_min: 640,
  xp_per_min: 720,
  hero_damage: 32000,
  hero_healing: 0,
  kills: 10,
  ...over,
});

const read = (over: Record<string, unknown> = {}): RecentMatch => {
  const match = readRecentMatch(row(over));
  if (!match) throw new Error("expected a match");
  return match;
};

Deno.test("reads a win from the player's slot and the winning side", () => {
  assertEquals(read().isWin, true);
  assertEquals(read({ player_slot: 130 }).isWin, false, "Dire player, Radiant won");
  assertEquals(read({ player_slot: 130, radiant_win: false }).isWin, true);
});

Deno.test("skips rows missing what every rule needs", () => {
  assertEquals(readRecentMatch(null), null);
  assertEquals(readRecentMatch(row({ radiant_win: null })), null, "game still running");
  assertEquals(readRecentMatch(row({ hero_id: 0 })), null);
  assertEquals(readRecentMatch(row({ duration: 0 })), null);
  assertEquals(read({ lane_role: null }).laneRole, null, "unparsed match");
});

Deno.test("counts draft modes in normal and ranked lobbies only", () => {
  assertEquals(isCountedGame(read(), NOW_S), true);
  for (const mode of [1, 2, 3, 4, 22]) assertEquals(isCountedGame(read({ game_mode: mode }), NOW_S), true);
  assertEquals(isCountedGame(read({ game_mode: 23 }), NOW_S), false, "Turbo");
  assertEquals(isCountedGame(read({ game_mode: 18 }), NOW_S), false, "Ability Draft");
  assertEquals(isCountedGame(read({ lobby_type: 1 }), NOW_S), false, "practice lobby");
  assertEquals(isCountedGame(read({ leaver_status: 2 }), NOW_S), false, "the player left");
  assertEquals(isCountedGame(read({ duration: 11 * 60 }), NOW_S), false, "remake length");
  assertEquals(isCountedGame(read({ start_time: NOW_S - 31 * DAY_S }), NOW_S), false, "older than 30 days");
  assertEquals(isCountedGame(read({ start_time: NOW_S - 31 * DAY_S }), NOW_S, 180), true, "inside a 180 day window");
});

Deno.test("guesses the position from the lane and farm, leaving the middle ground unknown", () => {
  // 40 minute games: 3 last hits a minute is 120.
  assertEquals(positionFromLane(read({ lane_role: 1, last_hits: 280 })), 1);
  assertEquals(positionFromLane(read({ lane_role: 1, last_hits: 40 })), 5);
  assertEquals(positionFromLane(read({ lane_role: 1, last_hits: 90 })), null);
  assertEquals(positionFromLane(read({ lane_role: 2, last_hits: 300 })), 2);
  assertEquals(positionFromLane(read({ lane_role: 2, last_hits: 60 })), null, "a support who went mid");
  assertEquals(positionFromLane(read({ lane_role: 3, last_hits: 200 })), 3);
  assertEquals(positionFromLane(read({ lane_role: 3, last_hits: 30 })), 4);
  assertEquals(positionFromLane(read({ lane_role: 3, last_hits: 80 })), null);
  assertEquals(positionFromLane(read({ lane_role: 4 })), null, "jungle");
  assertEquals(positionFromLane(read({ lane_role: null })), null, "unparsed");
  assertEquals(positionFromLane(read({ lane_role: null, is_roaming: true })), 4);
});

Deno.test("turns totals into per minute values", () => {
  const values = statValuesOf(read());
  assertEquals(values.gold_per_min, 640);
  assertEquals(values.last_hits_per_min, 7);
  assertEquals(values.hero_damage_per_min, 800);
  assertEquals(values.kills_per_min, 0.25);
});
