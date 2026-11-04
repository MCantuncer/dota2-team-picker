import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  guideListQuery,
  guideMatchIds,
  hasItems,
  matchesQuery,
  type MatchupGame,
  queriesNeeded,
  sliceGames,
  toMatchupGame,
} from "./queries.ts";

const SVEN_VS_LION = { hero: 18, position: 1, enemy: 26 };

Deno.test("asks for the win list of H against E and the loss list of E against H", () => {
  const q = guideListQuery([SVEN_VS_LION]);
  assertEquals(q.includes("w0: guide(heroId: 18, positionId: POSITION_1, againstHeroId: 26, take: 10)"), true);
  assertEquals(q.includes("l0: guide(heroId: 26, againstHeroId: 18, take: 10)"), true);
});

Deno.test("refuses bad slices and too many of them", () => {
  assertThrows(() => guideListQuery([]));
  assertThrows(() => guideListQuery([{ hero: 18, position: 6, enemy: 26 }]));
  assertThrows(() => guideListQuery([{ hero: 18, position: 1, enemy: 18 }]));
  assertThrows(() => guideListQuery([{ hero: 1.5, position: 1, enemy: 26 }]));
  assertThrows(() => guideListQuery(Array(26).fill(SVEN_VS_LION)));
});

Deno.test("reads match ids from a guide list, once each", () => {
  assertEquals(guideMatchIds({ guides: [{ matchId: 5 }, { matchId: 5 }, { matchId: "x" }, null, { matchId: 7 }] }), [
    5,
    7,
  ]);
  assertEquals(guideMatchIds(null), []);
  assertEquals(guideMatchIds({ guides: "no" }), []);
});

Deno.test("asks for up to 20 matches with every player, their side and purchases", () => {
  const q = matchesQuery([9]);
  assertEquals(q.includes("m0: match(id: 9) { id gameVersionId durationSeconds radiantNetworthLeads players {"), true);
  assertEquals(q.includes("isRadiant"), true);
  assertEquals(q.includes("stats { itemPurchases { time itemId } }"), true);
  assertThrows(() => matchesQuery([]));
  assertThrows(() => matchesQuery(Array(21).fill(1)));
  assertThrows(() => matchesQuery([0]));
});

function match(over: Record<string, unknown> = {}, sven: Record<string, unknown> = {}) {
  return {
    id: 100,
    gameVersionId: 184,
    durationSeconds: 1800,
    radiantNetworthLeads: [0, 100, -50],
    players: [
      {
        steamAccountId: 11,
        heroId: 18,
        position: "POSITION_1",
        level: 20,
        isVictory: true,
        isRadiant: true,
        abilities: [{ abilityId: 3, time: 200 }, { abilityId: 1, time: 100 }],
        stats: { itemPurchases: [{ itemId: 2, time: 300 }, { itemId: 1, time: -60 }] },
        ...sven,
      },
      { steamAccountId: 12, heroId: 26, position: "POSITION_5", level: 15, isVictory: false, abilities: [] },
    ],
    ...over,
  };
}

Deno.test("keeps H's game with points in time order", () => {
  assertEquals(toMatchupGame(match(), SVEN_VS_LION, true), {
    match: 100,
    account: 11,
    won: true,
    level: 20,
    version: 184,
    points: [1, 3],
    items: [[1, -60], [2, 300]],
    duration: 1800,
    lead: [0, 100, -50],
  });
});

Deno.test("turns the networth lead toward H when H is on Dire, and keeps a game without leads", () => {
  assertEquals(toMatchupGame(match({}, { isRadiant: false }), SVEN_VS_LION, true)?.lead, [0, -100, 50]);
  assertEquals(toMatchupGame(match({ radiantNetworthLeads: null }), SVEN_VS_LION, true)?.lead, []);
  assertEquals(toMatchupGame(match({ radiantNetworthLeads: [0, null, 5] }), SVEN_VS_LION, true)?.lead, [], "a gap");
  assertEquals(toMatchupGame(match({ radiantNetworthLeads: [0, 1.5] }), SVEN_VS_LION, true)?.lead, [], "not whole");
});

Deno.test("keeps a game with a purchase STRATZ can't name, without that purchase", () => {
  const purchases = [{ itemId: 0, time: 100 }, { itemId: null, time: 200 }, { itemId: 1 }, { itemId: 2, time: 300 }];
  const game = toMatchupGame(match({}, { stats: { itemPurchases: purchases } }), SVEN_VS_LION, true);
  assertEquals(game?.items, [[2, 300]]);
});

Deno.test("keeps a point STRATZ sends as ability 0 in its place", () => {
  const abilities = [{ abilityId: 1, time: 100 }, { abilityId: 0, time: 150 }, { abilityId: 3, time: 200 }];
  assertEquals(toMatchupGame(match({}, { abilities }), SVEN_VS_LION, true)?.points, [1, 0, 3]);
});

Deno.test("drops a game without H's purchase list, side or length", () => {
  assertEquals(toMatchupGame(match({}, { stats: null }), SVEN_VS_LION, true), null, "not parsed");
  assertEquals(toMatchupGame(match({}, { stats: { itemPurchases: null } }), SVEN_VS_LION, true), null, "no purchases");
  assertEquals(toMatchupGame(match({}, { isRadiant: null }), SVEN_VS_LION, true), null, "no side");
  assertEquals(toMatchupGame(match({ durationSeconds: null }), SVEN_VS_LION, true), null, "no length");
});

/** A real STRATZ answer (recorded 2026-11-04): Juggernaut pos 1 on Radiant beat Lion pos 5, 32:41. */
const FIXTURE = JSON.parse(await Deno.readTextFile(new URL("./fixtures/match-9075559586.json", import.meta.url)));

Deno.test("reads a real STRATZ match: Juggernaut's purchases, the length and the lead", () => {
  const jugg = toMatchupGame(FIXTURE.data.m0, { hero: 8, position: 1, enemy: 26 }, true);
  assertEquals(jugg?.duration, 1961);
  assertEquals(jugg?.items?.length, 21);
  assertEquals(jugg?.items?.[0], [44, -43]);
  assertEquals(jugg?.items?.at(-1), [108, 1873]);
  assertEquals(jugg?.lead?.length, 34);
  assertEquals(jugg?.lead?.at(-1), 24868);
  // One of the 18 points is STRATZ's ability 0; it is kept as 0.
  assertEquals(jugg?.points.length, 18);
  assertEquals(jugg?.points.filter((id) => id === 0).length, 1);
});

Deno.test("reads the same match from Lion's side, on Dire: the lead turns negative", () => {
  const lion = toMatchupGame(FIXTURE.data.m0, { hero: 26, position: 5, enemy: 8 }, false);
  assertEquals(lion?.won, false);
  assertEquals(lion?.lead?.at(-1), -24868);
  assertEquals(lion?.items?.[0], [44, -89]);
});

Deno.test("knows games saved before the item fields", () => {
  const old = { match: 1, account: 1, won: true, level: 20, version: 184, points: [] };
  assertEquals(hasItems(old), false);
  assertEquals(hasItems({ ...old, items: [], duration: 1800, lead: [] }), true);
});

Deno.test("drops a game that doesn't fit the slice or the list", () => {
  assertEquals(toMatchupGame(match(), SVEN_VS_LION, false), null, "a loss list game H won");
  assertEquals(toMatchupGame(match({}, { position: "POSITION_2" }), SVEN_VS_LION, true), null, "another position");
  assertEquals(toMatchupGame(match(), { ...SVEN_VS_LION, enemy: 5 }, true), null, "the enemy isn't in it");
  assertEquals(
    toMatchupGame(match({}, { abilities: [{ abilityId: 1 }] }), SVEN_VS_LION, true),
    null,
    "a point without its time",
  );
  assertEquals(toMatchupGame(match({ gameVersionId: null }), SVEN_VS_LION, true), null, "no version");
  assertEquals(toMatchupGame(null, SVEN_VS_LION, true), null, "no match");
});

Deno.test("drops a game where the enemy was on H's team", () => {
  const sameTeam = match();
  sameTeam.players[1]!.isVictory = true;
  assertEquals(toMatchupGame(sameTeam, SVEN_VS_LION, true), null);
});

Deno.test("keeps this patch, each match once and at most 2 games per account", () => {
  const game = (match: number, account: number, version = 184): MatchupGame => ({
    match,
    account,
    won: true,
    level: 20,
    version,
    points: [],
    items: [],
    duration: 1800,
    lead: [],
  });
  const kept = sliceGames([game(1, 7), game(1, 7), game(2, 7), game(3, 7), game(4, 8, 183), null, game(5, 8)], 184);
  assertEquals(kept.map((g) => g.match), [1, 2, 5]);
});

Deno.test("counts the STRATZ queries a lookup can take", () => {
  assertEquals(queriesNeeded(0), 0);
  // 25 slices: one list query, then up to 500 matches in 25 queries.
  assertEquals(queriesNeeded(25), 26);
  assertEquals(queriesNeeded(1), 2);
});
