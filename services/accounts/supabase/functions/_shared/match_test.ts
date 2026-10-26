import { assertEquals } from "jsr:@std/assert@1";
import { pickRecentMatch, readMatch } from "./match.ts";

const opened = new Date("2026-10-26T12:00:00Z");
const at = (iso: string) => Date.parse(iso) / 1000;

Deno.test("finds the first match after the draft with one of our heroes", () => {
  const recent = [
    { match_id: 3, hero_id: 5, start_time: at("2026-10-26T13:00:00Z"), player_slot: 130, radiant_win: true },
    { match_id: 2, hero_id: 5, start_time: at("2026-10-26T12:02:00Z"), player_slot: 130, radiant_win: false },
    { match_id: 1, hero_id: 5, start_time: at("2026-10-26T10:00:00Z"), player_slot: 1, radiant_win: true },
  ];
  assertEquals(pickRecentMatch(recent, [5, 6], opened), { matchId: 2, won: true });
});

Deno.test("skips other heroes, older games and games still running", () => {
  const recent = [
    { match_id: 1, hero_id: 7, start_time: at("2026-10-26T12:05:00Z"), player_slot: 1, radiant_win: true },
    { match_id: 2, hero_id: 5, start_time: at("2026-10-26T11:40:00Z"), player_slot: 1, radiant_win: true },
    { match_id: 3, hero_id: 5, start_time: at("2026-10-26T12:05:00Z"), player_slot: 1, radiant_win: null },
  ];
  assertEquals(pickRecentMatch(recent, [5], opened), null);
});

Deno.test("reads a pasted match when our heroes are on one side", () => {
  const match = {
    match_id: 9,
    radiant_win: true,
    players: [
      { hero_id: 1, player_slot: 0 },
      { hero_id: 2, player_slot: 1 },
      { hero_id: 5, player_slot: 128 },
      { hero_id: 6, player_slot: 129 },
    ],
  };
  assertEquals(readMatch(match, [1, 2]), { matchId: 9, won: true });
  assertEquals(readMatch(match, [5, 6]), { matchId: 9, won: false });
  assertEquals(readMatch(match, [1, 5]), null, "heroes split across both teams");
  assertEquals(readMatch(match, []), null, "a draft with no heroes for our team");
  assertEquals(readMatch({ match_id: 9, players: match.players }, [1]), null, "no result yet");
});
