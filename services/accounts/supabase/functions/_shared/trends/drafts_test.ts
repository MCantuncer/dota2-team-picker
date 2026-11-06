import { assertEquals } from "jsr:@std/assert@1";
import { readDraftGames } from "./drafts.ts";

const NOW_S = Date.parse("2026-11-03T12:00:00Z") / 1000;
const row = (over: Record<string, unknown> = {}, draft: Record<string, unknown> = {}, report: unknown = {}) => ({
  hero_id: 114,
  position: 1,
  ...over,
  party_drafts: {
    match_id: 9_000_000_001,
    won: true,
    ended_at: "2026-11-02T20:00:00Z",
    match_reports: report === null ? null : { game_mode: 22, lobby_type: 7, ...(report as object) },
    ...draft,
  },
});

Deno.test("reads a counted draft game with its planned position", () => {
  assertEquals(readDraftGames([row()], NOW_S), [
    {
      matchId: 9_000_000_001,
      heroId: 114,
      startTime: Date.parse("2026-11-02T20:00:00Z") / 1000,
      isWin: true,
      position: 1,
      gameMode: 22,
      lobbyType: 7,
    },
  ]);
});

Deno.test("accepts the report embedded as a list", () => {
  assertEquals(readDraftGames([row({}, { match_reports: [{ game_mode: 1, lobby_type: 0 }] })], NOW_S).length, 1);
});

Deno.test("skips games outside the rules", () => {
  const rows = [
    row({}, {}, { game_mode: 23 }),
    row({}, {}, { lobby_type: 1 }),
    row({}, {}, null),
    row({}, { won: null }),
    row({}, { match_id: null }),
    row({}, { ended_at: "2026-09-01T00:00:00Z" }),
    row({ position: null }),
    row({ position: 7 }),
    row({ hero_id: 0 }),
    null,
  ];
  assertEquals(readDraftGames(rows, NOW_S), []);
  assertEquals(readDraftGames(null, NOW_S), []);
});

Deno.test("reads older drafts inside a longer window when asked", () => {
  const old = [row({}, { ended_at: "2026-07-01T20:00:00Z" })];
  assertEquals(readDraftGames(old, NOW_S).length, 0);
  assertEquals(readDraftGames(old, NOW_S, 180).length, 1);
});
