import { assert, assertEquals } from "jsr:@std/assert@1";
import type { Position } from "../trends/games.ts";
import { type FillGame, fillHeroes, type FillPick, MAX_PER_POSITION, MIN_POSITIONED_GAMES } from "./rules.ts";

const NOW_S = Date.parse("2026-11-06T12:00:00Z") / 1000;
const DAY_S = 24 * 60 * 60;

const MEDUSA = 94, MONKEY_KING = 114, ANTI_MAGE = 1, SPECTRE = 67, SLARK = 93, URSA = 70, VENGEFUL = 20;
const SVEN_ID = 18;
const PUDGE = 14, DAZZLE = 50, RING_MASTER = 131, TUSK = 100, WINDRANGER = 21, INVOKER = 74;

/** `n` games on a hero and position, one a day back from `daysAgo`, the first `wins` won and `strong` strong. */
function games(
  heroId: number,
  position: Position | null,
  n: number,
  wins: number,
  strong = 0,
  daysAgo = 1,
): FillGame[] {
  return Array.from({ length: n }, (_, i) => ({
    heroId,
    position,
    startTime: NOW_S - (daysAgo + i) * DAY_S,
    isWin: i < wins,
    isStrong: i < strong,
  }));
}
/** Even filler on a position so it has an average near 50% with 30% strong games. */
const filler = (position: Position, n: number) =>
  Array.from(
    { length: n },
    (_, i) => games(1000 + i, position, 1, i % 2 === 0 ? 1 : 0, i % 10 < 3 ? 1 : 0, 2 + (i % 80)),
  )
    .flat();
const pick = (picks: FillPick[], heroId: number, position: Position) =>
  picks.find((p) => p.heroId === heroId && p.position === position);

Deno.test("Can's last 6 months fill the 15 heroes the plan shows", async () => {
  const fixture = JSON.parse(await Deno.readTextFile(new URL("./testdata/can_6_months.json", import.meta.url)));
  const can: FillGame[] = (fixture.rows as [number, number, number, number, number | null][]).map(
    ([heroId, secondsAgo, win, position, strong]) => ({
      heroId,
      startTime: NOW_S - secondsAgo,
      isWin: win === 1,
      position: position === 0 ? null : position as Position,
      isStrong: strong === null ? null : strong === 1,
    }),
  );
  const result = fillHeroes({ games: can, nowS: NOW_S });
  assertEquals(result.positions, [1, 2, 4, 5]);
  const byPosition = (p: Position) =>
    result.picks.filter((x) => x.position === p).map((x) => x.heroId).sort((a, b) => a - b);
  assertEquals(byPosition(1), [VENGEFUL, URSA, SLARK, MEDUSA, MONKEY_KING].sort((a, b) => a - b));
  assertEquals(byPosition(4), [PUDGE]);
  assertEquals(byPosition(5), [DAZZLE, RING_MASTER].sort((a, b) => a - b));
  assertEquals(byPosition(2).length, 7);
  assert(byPosition(2).includes(INVOKER), "Invoker mid is in on games despite 12 wins of 31");
  assertEquals(pick(result.picks, MONKEY_KING, 1)?.gamesNeeded, 20);
  const missed = (heroId: number, position: Position) =>
    result.nearMisses.find((m) => m.heroId === heroId && m.position === position);
  assertEquals(missed(ANTI_MAGE, 1)?.why, "needs 19 games at this record");
  assertEquals(missed(WINDRANGER, 4)?.why, "needs 12 games at this record");
  assertEquals(missed(TUSK, 5)?.why, "needs 14 games at this record");
  assertEquals(missed(SPECTRE, 1)?.why, "4 wins of 4 but only 3 strong games");
});

Deno.test("fewer positioned games than the minimum fill nothing", () => {
  const result = fillHeroes({ games: games(MEDUSA, 1, MIN_POSITIONED_GAMES - 1, 10), nowS: NOW_S });
  assertEquals(result.state, "too_few");
  assertEquals(result.picks, []);
});

Deno.test("a lot of games beats a losing record, a few losing games don't", () => {
  const result = fillHeroes({
    games: [...filler(1, 200), ...games(MONKEY_KING, 1, 40, 14, 12), ...games(ANTI_MAGE, 1, 12, 4, 3)],
    nowS: NOW_S,
  });
  assert(pick(result.picks, MONKEY_KING, 1), "40 games at 35% still go in");
  assertEquals(pick(result.picks, ANTI_MAGE, 1), undefined);
});

Deno.test("doing well lowers the games needed, never under 6", () => {
  const result = fillHeroes({
    games: [...filler(1, 200), ...games(SLARK, 1, 7, 6, 6), ...games(URSA, 1, 5, 5, 5, 40)],
    nowS: NOW_S,
  });
  assertEquals(pick(result.picks, SLARK, 1)?.kind, "regular");
  // 5 games is under the floor of 6, so Ursa can only come in as Proven.
  assertEquals(pick(result.picks, URSA, 1)?.kind, "proven");
});

Deno.test("Proven needs every game strong at 4 games and a recent game", () => {
  const all = fillHeroes({ games: [...filler(1, 200), ...games(SPECTRE, 1, 4, 4, 4)], nowS: NOW_S });
  assertEquals(pick(all.picks, SPECTRE, 1)?.kind, "proven");
  const three = fillHeroes({ games: [...filler(1, 200), ...games(SPECTRE, 1, 4, 4, 3)], nowS: NOW_S });
  assertEquals(pick(three.picks, SPECTRE, 1), undefined);
  const old = fillHeroes({ games: [...filler(1, 200), ...games(SPECTRE, 1, 4, 4, 4, 100)], nowS: NOW_S });
  assertEquals(pick(old.picks, SPECTRE, 1), undefined);
  const unknown = fillHeroes({
    games: [...filler(1, 200), ...games(SPECTRE, 1, 4, 4, 4).map((g, i) => (i === 0 ? { ...g, isStrong: null } : g))],
    nowS: NOW_S,
  });
  assertEquals(pick(unknown.picks, SPECTRE, 1), undefined);
});

Deno.test("only one Proven hero per position", () => {
  const result = fillHeroes({
    games: [...filler(1, 200), ...games(SPECTRE, 1, 5, 5, 5), ...games(SVEN_ID, 1, 4, 4, 4)],
    nowS: NOW_S,
  });
  assertEquals(result.picks.filter((p) => p.kind === "proven").map((p) => p.heroId), [SPECTRE]);
  assertEquals(result.nearMisses.find((m) => m.heroId === SVEN_ID)?.why, "only 1 rare hero per position");
});
Deno.test("positions under 10% of games or 15 games are not the player's", () => {
  const result = fillHeroes({
    games: [...filler(2, 200), ...games(PUDGE, 4, 14, 10, 5), ...filler(3, 10)],
    nowS: NOW_S,
  });
  assertEquals(result.positions, [2]);
});

Deno.test("a position with 50 games counts even under 10% of games", () => {
  const result = fillHeroes({
    games: [...filler(2, 600), ...filler(5, 50), ...filler(3, 49)],
    nowS: NOW_S,
  });
  assertEquals(result.positions, [2, 5]);
});

Deno.test("removed heroes and positions stay out", () => {
  const input = [...filler(1, 100), ...filler(5, 100), ...games(MEDUSA, 1, 30, 15, 10), ...games(DAZZLE, 5, 30, 15, 5)];
  const result = fillHeroes({ games: input, nowS: NOW_S, removed: new Set([`${MEDUSA}:1`, "0:5"]) });
  assertEquals(result.positions, [1]);
  assertEquals(pick(result.picks, MEDUSA, 1), undefined);
  assertEquals(pick(result.picks, DAZZLE, 5), undefined);
});

Deno.test("at most 8 heroes a position, the least played cut", () => {
  const many = Array.from({ length: 10 }, (_, i) => games(200 + i, 1, 20 + i, 10 + Math.floor(i / 2), 6)).flat();
  const result = fillHeroes({ games: many, nowS: NOW_S });
  const carry = result.picks.filter((p) => p.position === 1);
  assertEquals(carry.length, MAX_PER_POSITION);
  const cut = result.nearMisses.filter((m) => m.why === "past the 8 hero cap").map((m) => m.heroId);
  assertEquals(cut.sort(), [200, 201], "the two least played heroes are cut");
});

Deno.test("games older than 6 months don't count", () => {
  const result = fillHeroes({ games: [...filler(1, 50), ...games(MEDUSA, 1, 30, 20, 10, 190)], nowS: NOW_S });
  assertEquals(result.games, 50);
  assertEquals(pick(result.picks, MEDUSA, 1), undefined);
});
