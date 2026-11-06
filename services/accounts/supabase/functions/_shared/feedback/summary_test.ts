import { assertAlmostEquals, assertEquals } from "jsr:@std/assert@1";
import { readOpenDotaMatch } from "../report/match.ts";
import { summarizeGame, type SummaryInput } from "./summary.ts";

const raw = (): Record<string, unknown> =>
  JSON.parse(Deno.readTextFileSync(new URL("../report/fixtures/all-pick-9072422905.json", import.meta.url)));

// Bloodseeker (account 1000) played mid for Radiant and lost.
const HERO_IDS = {
  npc_dota_hero_bloodseeker: 4,
  npc_dota_hero_lina: 25,
  npc_dota_hero_lion: 26,
  npc_dota_hero_ogre_magi: 84,
  npc_dota_hero_kez: 145,
};
const input = (over: Partial<SummaryInput> = {}): SummaryInput => ({
  match: readOpenDotaMatch(raw()),
  accountId: 1000,
  startTime: 1_793_571_320,
  position: 2,
  items: {},
  heroIdsByKey: HERO_IDS,
  ...over,
});

Deno.test("sums up laning at 10 minutes against the lane opponent", () => {
  const s = summarizeGame(input());
  assertEquals([s?.heroId, s?.isWin, s?.isParsed, s?.position], [4, false, true, 2]);
  assertEquals([s?.lastHitsAt10, s?.deniesAt10], [46, 7]);
  assertEquals(s?.laneNetWorthDiffAt10, 3770 - 3888, "Lina was 118 gold ahead in mid");
});

Deno.test("each death names the killer and the buildings lost while dead", () => {
  const deaths = summarizeGame(input())?.deaths ?? [];
  assertEquals(deaths.length, 8);
  assertEquals(deaths[0], {
    time: 344,
    goldLost: 56,
    timeDead: 24,
    killerHeroId: 25,
    isKillerFromMid: false,
    buildingsLost: [],
  });
  assertEquals(deaths[2]?.buildingsLost, ["npc_dota_goodguys_tower1_mid"], "died at 11:49, mid tower fell at 12:09");
  assertEquals(deaths[5]?.killerHeroId, 26, "Lion");
  assertEquals(deaths[5]?.buildingsLost, [
    "npc_dota_goodguys_tower2_mid",
    "npc_dota_goodguys_tower3_mid",
    "npc_dota_goodguys_range_rax_mid",
    "npc_dota_goodguys_melee_rax_mid",
  ]);
});

Deno.test("a mid hero killing someone from another lane counts as a rotation", () => {
  // Lina (mid) killed Radiant's offlane Invoker at 8:58.
  const s = summarizeGame(input({ accountId: 1004 }));
  const fromLina = s?.deaths?.filter((d) => d.killerHeroId === 25) ?? [];
  assertEquals(fromLina.map((d) => [d.time, d.isKillerFromMid]), [[538, true]]);
});

Deno.test("an unknown killer key or a creep leaves the killer empty", () => {
  const deaths = summarizeGame(input({ heroIdsByKey: {} }))?.deaths ?? [];
  assertEquals(deaths.every((d) => d.killerHeroId === null && d.isKillerFromMid === null), true);
});

Deno.test("percentiles include deaths, as OpenDota gives them (higher is fewer deaths)", () => {
  const p = summarizeGame(input())?.percentiles;
  assertAlmostEquals(p?.deathsPerMin ?? -1, 0.3375, 0.001);
  assertEquals(p?.towerDamage !== null && p?.heroHealingPerMin !== null, true);
});

Deno.test("an unparsed match keeps only the basic numbers", () => {
  const s = summarizeGame(input({ match: readOpenDotaMatch({ ...raw(), version: null }) }));
  assertEquals([s?.isParsed, s?.deaths, s?.lastHitsAt10, s?.laneNetWorthDiffAt10], [false, null, null, null]);
  assertEquals(s?.card.kills, readOpenDotaMatch(raw()).players[0]?.kills);
});

Deno.test("returns null when the account didn't play the match", () => {
  assertEquals(summarizeGame(input({ accountId: 42 })), null);
});
