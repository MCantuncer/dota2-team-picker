import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { biggestSwings, buildFacts, type ItemCost, laneResults } from "./facts.ts";
import { type Match, readOpenDotaMatch } from "./match.ts";

const fixture = (name: string): unknown =>
  JSON.parse(Deno.readTextFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

// All Pick, 34 minutes, Dire won 57 to 32. Kez (145) farmed top for Dire.
const allPick = () => readOpenDotaMatch(fixture("all-pick-9072422905.json"));

const ITEMS: Record<string, ItemCost> = {
  power_treads: { id: 63, cost: 1400 },
  desolator: { id: 168, cost: 3500 },
  yasha: { id: 170, cost: 2050 },
  manta: { id: 147, cost: 4650 },
  sphere: { id: 123, cost: 4600 },
  butterfly: { id: 139, cost: 5450 },
  swift_blink: { id: 603, cost: 6800 },
};

Deno.test("reads a parsed OpenDota match", () => {
  const match = allPick();
  assertEquals([match.matchId, match.isParsed, match.durationS, match.gameMode], [9072422905, true, 2066, 22]);
  assertEquals(match.players.length, 10);
  assertEquals(match.radiantGoldAdv?.length, 35);
});

Deno.test("refuses a response without the core fields", () => {
  assertThrows(() => readOpenDotaMatch(null));
  assertThrows(() => readOpenDotaMatch({ match_id: 1, radiant_win: true, duration: 60, players: [] }));
  const raw = fixture("all-pick-9072422905.json") as { players: { hero_id: unknown }[] };
  raw.players[3]!.hero_id = 0; // The fixture has 10 players.
  assertThrows(() => readOpenDotaMatch(raw));
});

Deno.test("works out the header and lanes from our side", () => {
  const facts = buildFacts(allPick(), false, ITEMS);
  assertEquals([facts.side, facts.won, facts.isBasic], ["dire", true, false]);
  assertEquals(facts.score, { ours: 57, theirs: 32 });
  assertEquals(facts.enemyHeroes, [4, 38, 46, 14, 74]);
  assertEquals(facts.goldLead?.[1], 726, "Radiant's lead turned into ours");
  assertEquals(facts.lanes, [
    { lane: "bottom", ourHeroes: [70, 26], theirHeroes: [46, 14], netWorthDiff: 777 },
    { lane: "mid", ourHeroes: [25], theirHeroes: [4], netWorthDiff: 118 },
    { lane: "top", ourHeroes: [84, 145], theirHeroes: [38, 74], netWorthDiff: 2620 },
  ]);
  const radiant = buildFacts(allPick(), true, ITEMS);
  assertEquals(radiant.lanes?.map((l) => l.netWorthDiff), [-777, -118, -2620]);
  assertEquals(radiant.won, false);
});

Deno.test("fills a hero card", () => {
  const kez = buildFacts(allPick(), false, ITEMS).heroes.find((h) => h.heroId === 145)!; // In the fixture.
  assertEquals([kez.kills, kez.deaths, kez.assists, kez.lane, kez.abandoned], [35, 1, 6, "top", false]);
  assertEquals(kez.benchmarks?.goldPerMin, 100);
  assertEquals(kez.keyItems?.map((i) => i.itemId), [168, 170, 147, 123, 139, 603], "cheap items left out, 6 at most");
  assertEquals(kez.keyItems?.[0], { itemId: 168, minute: 12 });
  assertEquals(kez.deathsBefore10, 0);

  const invoker = buildFacts(allPick(), true, ITEMS).heroes.find((h) => h.heroId === 74)!; // In the fixture.
  assertEquals([invoker.deathsBefore10, invoker.goldLostToDeaths], [3, 2131]);
});

Deno.test("leaves out key items without the item list", () => {
  assertEquals(buildFacts(allPick(), false).heroes[0]?.keyItems, null);
});

Deno.test("builds a basic report from an unparsed match", () => {
  const raw = fixture("all-pick-9072422905.json") as Record<string, unknown>;
  delete raw.version;
  const facts = buildFacts(readOpenDotaMatch(raw), false, ITEMS);
  assertEquals([facts.isBasic, facts.goldLead, facts.swings, facts.lanes], [true, null, null, null]);
  const card = facts.heroes[0]!; // Five heroes per side.
  assertEquals([card.lane, card.keyItems, card.wards, card.deathsBefore10], [null, null, null, null]);
  assertEquals(card.kills, 5, "the scoreboard is still there");
});

Deno.test("reads a Turbo match too, marked by its game mode", () => {
  const facts = buildFacts(readOpenDotaMatch(fixture("turbo-9057810308.json")), true, ITEMS);
  assertEquals(facts.gameMode, 23);
  assertEquals(facts.heroes.length, 5);
});

Deno.test("picks the biggest lead swings without overlap", () => {
  const lead = [0, 100, 200, 300, 2300, 2400, 2400, 400, 300, 300];
  assertEquals(biggestSwings(lead), [
    { fromMinute: 1, toMinute: 4, change: 2200 },
    { fromMinute: 5, toMinute: 8, change: -2100 },
  ]);
  assertEquals(biggestSwings([5, 5, 5, 5, 5]), [], "a flat game has no swings");
});

Deno.test("gives no lane result when a lane player's net worth is missing", () => {
  const match: Match = allPick();
  const ours = match.players.slice(5).map((p) => ({ ...p, netWorthByMinute: null }));
  assertEquals(laneResults(ours, match.players.slice(0, 5)), null);
});

Deno.test("matches the saved version 1 facts the website reads", () => {
  const saved = fixture("facts-v1-dire-9072422905.json");
  assertEquals(buildFacts(allPick(), false, ITEMS), saved);
});

Deno.test("finds the fights that moved the most gold", () => {
  const fights = buildFacts(allPick(), false, ITEMS).fights!; // Parsed match.
  assertEquals(fights.length, 4);
  assertEquals(fights.map((f) => f.startMinute), [...fights.map((f) => f.startMinute)].sort((a, b) => a - b));
  const radiant = buildFacts(allPick(), true, ITEMS).fights!; // Parsed match.
  assertEquals(
    radiant.map((f) => f.goldSwing),
    fights.map((f) => -f.goldSwing),
    "the same fights, seen from the other side",
  );
  assertEquals(radiant.map((f) => f.ourDeaths), fights.map((f) => f.theirDeaths));
});

Deno.test("names what hurt us most and the enemy's best hero", () => {
  const facts = buildFacts(allPick(), true, ITEMS);
  assertEquals(facts.damageTaken?.length, 3);
  assertEquals(facts.damageTaken![0]!.damage >= facts.damageTaken![1]!.damage, true); // Three sources, checked above.
  assertEquals(facts.enemyBest, { heroId: 145, kills: 35, deaths: 1, assists: 6, netWorth: facts.enemyBest!.netWorth });
  assertEquals(buildFacts(allPick(), false, ITEMS).enemyBest?.heroId !== 145, true);
});

Deno.test("places each pick in the list its player saw", () => {
  const facts = buildFacts(allPick(), false, ITEMS, [
    { heroId: 145, shown: [12, 145, 8] },
    { heroId: 25, shown: [1, 2, 3, 4, 5, 6, 7, 8] },
    { heroId: 70, shown: [] },
  ]);
  assertEquals(facts.draft, [
    { heroId: 145, suggestionRank: 2, listSize: 3 },
    { heroId: 25, suggestionRank: null, listSize: 8 },
    { heroId: 70, suggestionRank: null, listSize: 0 },
  ]);
  assertEquals(buildFacts(allPick(), false, ITEMS).draft, null, "no saved draft");
});

Deno.test("leaves fights and damage out of a basic report", () => {
  const raw = fixture("all-pick-9072422905.json") as Record<string, unknown>;
  delete raw.version;
  const facts = buildFacts(readOpenDotaMatch(raw), false, ITEMS);
  assertEquals([facts.fights, facts.damageTaken], [null, null]);
  assertEquals(
    facts.enemyBest,
    buildFacts(allPick(), false, ITEMS).enemyBest,
    "the scoreboard still shows who did best",
  );
});
