import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { type AttachClient, attachMatch, type FindDeps, findDraftMatch } from "./attach.ts";
import type { MatchDetails } from "./match.ts";

const opened = new Date("2026-10-26T12:00:00Z");
const at = (iso: string) => Date.parse(iso) / 1000;

const match: MatchDetails = {
  match_id: 42,
  radiant_win: false,
  game_mode: 22,
  lobby_type: 7,
  players: [
    { hero_id: 1, player_slot: 0, account_id: 10 },
    { hero_id: 2, player_slot: 1, account_id: null },
    { hero_id: 5, player_slot: 128, account_id: 20 },
  ],
};

const deps = (
  recent: Record<number, number>,
  details: MatchDetails | null = match,
): FindDeps & { fetched: number[] } => {
  const fetched: number[] = [];
  return {
    fetched,
    fetchRecentMatches: (accountId) =>
      Promise.resolve(
        recent[accountId]
          ? [{
            match_id: 42,
            hero_id: recent[accountId],
            start_time: at("2026-10-26T12:05:00Z"),
            player_slot: 0,
            radiant_win: false,
          }]
          : [],
      ),
    fetchMatch: (id) => (fetched.push(id), Promise.resolve(details)),
  };
};

Deno.test("finds the match and confirms every ally hero is on one side", async () => {
  const d = deps({ 11: 1 });
  const found = await findDraftMatch(d, [10, 11], [1, 2], opened);
  assertEquals(found?.side, { matchId: 42, won: false, isRadiant: true });
  assertEquals(d.fetched, [42]);
});

Deno.test("doesn't attach a game that holds only one of our heroes", async () => {
  assertEquals(await findDraftMatch(deps({ 10: 1 }), [10], [1, 7], opened), null);
});

Deno.test("finds nothing when no player has a fitting recent game", async () => {
  const d = deps({});
  assertEquals(await findDraftMatch(d, [10, 11], [1], opened), null);
  assertEquals(d.fetched, [], "no match lookup without a candidate");
});

const client = (data: boolean | null, error: unknown = null): AttachClient & { args: unknown[] } => {
  const args: unknown[] = [];
  return { args, rpc: (_fn, a) => (args.push(a), Promise.resolve({ data, error })) };
};

Deno.test("attaches the match with our side's players", async () => {
  const c = client(true);
  assertEquals(await attachMatch(c, "d1", { match, side: { matchId: 42, won: false, isRadiant: true } }), true);
  assertEquals(c.args, [{
    draft: "d1",
    match: 42,
    did_win: false,
    our_players: [{ account_id: 10, hero_id: 1 }, { account_id: null, hero_id: 2 }],
    mode: 22,
    lobby: 7,
  }]);
});

Deno.test("reports when another caller attached first, and throws on a database error", async () => {
  const found = { match, side: { matchId: 42, won: false, isRadiant: true } };
  assertEquals(await attachMatch(client(false), "d1", found), false);
  await assertRejects(() => attachMatch(client(null, { message: "down" }), "d1", found));
});
