import { assertEquals } from "jsr:@std/assert@1";
import { readOpenDotaMatch } from "../report/match.ts";
import { buildingName, deathFindings } from "./deaths.ts";
import type { FightLabel } from "./fights.ts";
import { summarizeGame } from "./summary.ts";
import type { DeathFact, GameSummary } from "./summary.ts";

const HERO_IDS: Record<string, number> = {
  npc_dota_hero_sniper: 35,
  npc_dota_hero_visage: 92,
  npc_dota_hero_rubick: 86,
  npc_dota_hero_legion_commander: 104,
  npc_dota_hero_necrolyte: 36,
  npc_dota_hero_nyx_assassin: 88,
};
const HEROES: Record<number, string> = {
  35: "Sniper",
  92: "Visage",
  86: "Rubick",
  104: "Legion Commander",
  36: "Necrophos",
  88: "Nyx Assassin",
};
const names = { hero: (id: number) => HEROES[id] ?? `Hero ${id}` };

function summary(file: string, accountId: number): GameSummary {
  const raw = JSON.parse(Deno.readTextFileSync(new URL(`./fixtures/${file}`, import.meta.url)));
  const s = summarizeGame({
    match: readOpenDotaMatch(raw),
    accountId,
    startTime: 0,
    position: 1,
    items: {},
    heroIdsByKey: HERO_IDS,
  });
  if (!s) throw new Error("no summary");
  return s;
}
const headlines = (s: GameSummary) => deathFindings(s, names).map((f) => `${f.tone}:${f.headline}`);

Deno.test("Ursa 21/4/11: a stomp shows only the costliest death, with no advice", () => {
  const found = deathFindings(summary("ursa-9073776545.json", 1000), names);
  assertEquals(found.map((f) => f.headline), ["Costliest Death"]);
  assertEquals(found[0]?.happened, [
    "37:39: Rubick killed you in a fight your side lost 4 for 0. You were dead 101 seconds and your Tier 2 Top Tower fell.",
  ]);
  assertEquals(found[0]?.cost, "2,163 gold to Rubick, almost as much as your other 3 deaths together (2,228).");
  assertEquals(found[0]?.change, null);
});

Deno.test("Sven 36/7/23: caught alone, lost fights and good trades, each from this game", () => {
  const sven = summary("sven-9073477575.json", 1005);
  assertEquals(headlines(sven), ["problem:Caught Alone 2 Times", "problem:2 Lost Fights", "strength:Good Trades"]);
  const [alone, lost, good] = deathFindings(sven, names);
  assertEquals(alone?.happened, [
    "14:07: Nyx Assassin killed you with no fight around (1 for 0). " +
    "Your side had 4 observers up anywhere on the map, theirs had 0.",
    "22:01: Legion Commander killed you with no fight around (1 for 0). " +
    "Your side had 0 observers up anywhere on the map, theirs had 4.",
  ]);
  assertEquals(alone?.cost, "1,102 gold to Nyx Assassin and Legion Commander, 82 seconds dead.");
  assertEquals(lost?.happened, [
    "18:04: your side lost 5 for 2 (the fight started at 17:42), Necrophos got the kill on you.",
    "19:49: your side lost 2 for 0, Necrophos got the kill on you, your Tier 2 Top Tower fell while you were dead 46 seconds.",
  ]);
  assertEquals(good?.happened, [
    "42:35: you died, and your side won the fight 1 for 3.",
    "45:09: you died, and your side won the fight 2 for 4.",
  ]);
  assertEquals(deathFindings(sven, names).every((f) => f.change === null), true, "no data, no advice");
});

let at = 600;
function death(label: FightLabel, over: Partial<DeathFact> = {}): DeathFact {
  const [ourDeaths, theirDeaths] =
    { caught_alone: [1, 0], lost_fight: [3, 1], even_trade: [2, 2], close_win: [2, 3], good_trade: [1, 3] }[label];
  at += 120;
  return {
    time: at,
    goldLost: 100,
    timeDead: 30,
    killerHeroId: 104,
    isKillerFromMid: false,
    buildingsLost: [],
    goldFed: 400,
    fight: { startS: at, endS: at, ourDeaths: ourDeaths!, theirDeaths: theirDeaths!, label },
    wardsUp: null,
    isKillerFromOtherLane: false,
    didKillerTakeRune: false,
    ...over,
  };
}
const SVEN = summary("sven-9073477575.json", 1005);
function game(deaths: DeathFact[], deathsPerMin = 0.5): GameSummary {
  // Safe: the Sven game has percentiles; only deaths and the deaths percentile change.
  return { ...SVEN, deaths, percentiles: { ...SVEN.percentiles!, deathsPerMin } };
}

Deno.test("close wins and even trades are never a problem", () => {
  assertEquals(headlines(game([death("close_win"), death("even_trade")])), []);
});

Deno.test("an even trade gets the costliest card only when it cost 1,500 gold or a building", () => {
  assertEquals(headlines(game([death("even_trade", { goldFed: 1499 })])), []);
  assertEquals(headlines(game([death("even_trade", { goldFed: 1500 })])), ["problem:Costliest Death"]);
  assertEquals(
    headlines(game([death("even_trade", { goldFed: 1600 }), death("caught_alone", { goldFed: 1700 })])),
    ["problem:Caught Alone"],
    "the costliest is already on the caught alone card",
  );
});

Deno.test("a stomp with only cheap deaths shows nothing", () => {
  assertEquals(headlines(game([death("caught_alone"), death("lost_fight")], 0.8)), []);
  const costly = game(
    [death("caught_alone"), death("lost_fight", { goldFed: 500, buildingsLost: ["npc_dota_badguys_tower1_mid"] })],
    0.8,
  );
  assertEquals(deathFindings(costly, names)[0]?.happened[0]?.endsWith("and your Tier 1 Mid Tower fell."), true);
});

Deno.test("first blood before the horn is said as it is", () => {
  const found = deathFindings(game([death("caught_alone", { time: -46, killerHeroId: 35 })]), names);
  assertEquals(found[0]?.happened, ["-0:46: Sniper got first blood on you before the horn."]);
});

Deno.test("a rotation is named only before 12:00 with both the other lane and the rune known", () => {
  const rotation = { killerHeroId: 35, isKillerFromOtherLane: true, didKillerTakeRune: true };
  const line = (d: DeathFact) => deathFindings(game([d]), names)[0]?.happened[0];
  assertEquals(
    line(death("caught_alone", { ...rotation, time: 500 })),
    "8:20: Sniper killed you with no fight around (1 for 0); Sniper came from another lane and took a power rune " +
      "in the minute before.",
  );
  assertEquals(
    line(death("caught_alone", { ...rotation, time: 720 })),
    "12:00: Sniper killed you with no fight around (1 for 0).",
  );
  assertEquals(
    line(death("caught_alone", { ...rotation, time: 500, didKillerTakeRune: null })),
    "8:20: Sniper killed you with no fight around (1 for 0).",
  );
});

Deno.test("a repeat killer needs 3 kills and more than half of the deaths", () => {
  const three = [death("caught_alone"), death("caught_alone"), death("lost_fight")];
  assertEquals(
    deathFindings(game(three), names)[0]?.pattern,
    "Legion Commander got 3 of your 3 deaths in this game.",
  );
  const half = [...three, ...[1, 2, 3].map(() => death("good_trade", { killerHeroId: 36 }))];
  assertEquals(deathFindings(game(half), names)[0]?.pattern, null, "3 of 6 is not more than half");
});

Deno.test("an older summary without fights gets no death cards here", () => {
  const { fight: _, ...old } = death("caught_alone");
  assertEquals(deathFindings(game([old]), names), []);
});

Deno.test("building keys read as the player says them", () => {
  assertEquals(
    [
      "npc_dota_goodguys_tower2_top",
      "npc_dota_badguys_tower1_bot",
      "npc_dota_goodguys_tower4",
      "npc_dota_badguys_range_rax_mid",
      "npc_dota_goodguys_melee_rax_bot",
      "npc_dota_badguys_fort",
    ].map(buildingName),
    [
      "Tier 2 Top Tower",
      "Tier 1 Bottom Tower",
      "Tier 4 Tower",
      "Mid Ranged Barracks",
      "Bottom Melee Barracks",
      "Ancient",
    ],
  );
});
