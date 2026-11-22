import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { detailsQuery, readDetails, toSimilarMatch } from "./details.ts";

const fixture = JSON.parse(await Deno.readTextFile(new URL("./fixtures/stratz-matches.json", import.meta.url)));
const INVOKER = 74;

Deno.test("asks for up to 20 matches with what Similar Games needs, and no player names", () => {
  const q = detailsQuery([9099898435, 9100802831]);
  assertEquals(q.includes("m1: match(id: 9100802831) { id durationSeconds didRadiantWin players {"), true);
  assertEquals(q.includes("steamAccountId heroId isRadiant position lane kills deaths assists networth"), true);
  assertEquals(q.includes("deathEvents { time attacker } itemPurchases { time itemId }"), true);
  assertEquals(q.includes("name"), false);
  assertThrows(() => detailsQuery([]));
  assertThrows(() => detailsQuery(Array(21).fill(1)));
  assertThrows(() => detailsQuery([0]));
});

Deno.test("reads a real STRATZ match", () => {
  const [match] = readDetails(fixture.data);
  assertEquals(match.match, 9099898435);
  assertEquals(match.duration, 2427);
  assertEquals(match.players.length, 10);
  const invoker = match.players.find((p) => p.hero === INVOKER)!; // Invoker is in this match.
  assertEquals(invoker.position, 2);
  assertEquals([invoker.kills, invoker.deaths, invoker.assists], [11, 4, 11]);
  // OpenDota's parse of the same match says 37 last hits at 10 minutes.
  assertEquals(invoker.lastHits10, 37);
  // Four deaths, first to Axe (2) at 5:49, as OpenDota's kill log says.
  assertEquals(invoker.deathsAt.length, 4);
  assertEquals(invoker.deathsAt[0], [349, 2]);
  // First buys only, in order: Tango (42) once though bought four times; Meteor Hammer (223) at 11:57, as OpenDota
  // says (12 min).
  const ids = invoker.buys.map(([id]) => id);
  assertEquals(new Set(ids).size, ids.length);
  assertEquals(invoker.buys.find(([id]) => id === 223), [223, 717]);
  assertEquals(invoker.buys.every(([, t], i, all) => i === 0 || all[i - 1][1] <= t), true);
  // That query asked for no lane or account.
  assertEquals([invoker.lane, invoker.account], [null, null]);
});

/** A match of ten made-up players, each one changeable. */
function match(player: (i: number) => Record<string, unknown> = () => ({})) {
  return {
    id: 5,
    durationSeconds: 2000,
    didRadiantWin: true,
    players: Array.from({ length: 10 }, (_, i) => ({
      steamAccountId: i === 0 ? 1234 : null,
      heroId: i + 1,
      isRadiant: i < 5,
      position: `POSITION_${(i % 5) + 1}`,
      lane: "MID_LANE",
      kills: 1,
      deaths: 1,
      assists: 1,
      networth: 1000,
      stats: {
        lastHitsPerMinute: [1, 2],
        deathEvents: [{ time: 900, attacker: 0 }],
        itemPurchases: [{ time: 30, itemId: 0 }, { time: 20, itemId: 7 }, { time: 10, itemId: 7 }],
      },
      ...player(i),
    })),
  };
}

Deno.test("keeps the lane and account, drops what it can't name", () => {
  const m = toSimilarMatch(match())!; // A full made-up match reads.
  const p = m.players[0];
  assertEquals([p.lane, p.account, p.position], ["mid", 1234, 1]);
  assertEquals(m.players[1].account, null);
  // Item 0 is left out; item 7 counts once, at its first buy.
  assertEquals(p.buys, [[7, 10]]);
  // An attacker that isn't a hero is null; too few minutes give no last hits at 10.
  assertEquals(p.deathsAt, [[900, null]]);
  assertEquals(p.lastHits10, null);
  assertEquals(toSimilarMatch(match(() => ({ lane: "ROAMING", position: null })))!.players[0].lane, null);
});

Deno.test("leaves out a match it can't read in full", () => {
  assertEquals(toSimilarMatch(null), null);
  assertEquals(toSimilarMatch({ ...match(), players: match().players.slice(0, 9) }), null);
  assertEquals(toSimilarMatch(match((i) => (i === 3 ? { stats: null } : {}))), null);
  assertEquals(toSimilarMatch(match((i) => (i === 3 ? { kills: -1 } : {}))), null);
  assertEquals(toSimilarMatch(match((i) => (i === 3 ? { heroId: 1 } : {}))), null);
  assertEquals(toSimilarMatch(match((i) => (i === 3 ? { isRadiant: false } : {}))), null);
  assertEquals(
    toSimilarMatch(match((i) => (i === 3 ? { stats: { deathEvents: [{ time: "x" }], itemPurchases: [] } } : {}))),
    null,
  );
  // STRATZ answers null for a match it doesn't have; the others still read.
  assertEquals(readDetails({ m0: null, m1: match() }).map((m) => m.match), [5]);
  assertEquals(readDetails(null), []);
});
