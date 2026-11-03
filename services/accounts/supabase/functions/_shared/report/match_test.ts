import { assertEquals } from "jsr:@std/assert@1";
import { readOpenDotaMatch } from "./match.ts";

const fixture = (name: string): unknown =>
  JSON.parse(Deno.readTextFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

// Game feedback relies on these fields. If OpenDota stops sending one, this fails first.
Deno.test("a parsed match gives every field game feedback reads", () => {
  const match = readOpenDotaMatch(fixture("all-pick-9072422905.json"));
  for (const p of match.players) {
    assertEquals(p.lastHitsByMinute !== null && p.lastHitsByMinute.length > 10, true, "lh_t");
    assertEquals(p.deniesByMinute !== null && p.deniesByMinute.length > 10, true, "dn_t");
    assertEquals(p.xpByMinute !== null && p.xpByMinute.length > 10, true, "xp_t");
    assertEquals(p.stunSeconds !== null, true, "stuns");
    assertEquals(p.observersPlaced !== null && p.sentriesPlaced !== null, true, "wards placed");
    const other = p.otherBenchmarks;
    assertEquals(
      other !== null && Object.values(other).every((pct) => pct !== null && pct >= 0 && pct <= 1),
      true,
      "kills, deaths, assists, denies, healing and tower damage benchmarks",
    );
  }
  assertEquals((match.buildingKills?.length ?? 0) > 0, true, "building kills");
});

Deno.test("reads who landed the killing blow from the deaths log", () => {
  const match = readOpenDotaMatch(fixture("all-pick-9072422905.json"));
  const first = match.players[0]?.deathsLog?.[0];
  assertEquals(first, { time: 344, goldLost: 56, timeDead: 24, killer: "npc_dota_hero_lina" });
});

Deno.test("building kills come in time order with the building's key", () => {
  const kills = readOpenDotaMatch(fixture("all-pick-9072422905.json")).buildingKills ?? [];
  assertEquals(kills[0], { time: 729, key: "npc_dota_goodguys_tower1_mid" });
  assertEquals(kills.every((k, i) => i === 0 || (kills[i - 1]?.time ?? 0) <= k.time), true);
});

Deno.test("an unparsed match leaves the parsed only fields empty", () => {
  const raw = fixture("all-pick-9072422905.json") as Record<string, unknown>;
  const match = readOpenDotaMatch({ ...raw, version: null });
  assertEquals(match.buildingKills, null);
  assertEquals(match.players[0]?.lastHitsByMinute, null);
  assertEquals(match.players[0]?.xpByMinute, null);
});
