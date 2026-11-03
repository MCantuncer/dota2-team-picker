import { assertAlmostEquals, assertEquals } from "jsr:@std/assert@1";
import { judgeByBenchmarks, percentileOf, readHeroBenchmarks, statsFor } from "./benchmarks.ts";

/** The shape of GET /benchmarks?hero_id=74 (checked live 2026-11-02), trimmed. */
const raw = {
  hero_id: 74,
  result: {
    gold_per_min: [
      { percentile: 0.1, value: 313 },
      { percentile: 0.5, value: 493 },
      { percentile: 0.9, value: 679 },
      { percentile: 0.99, value: 818 },
    ],
    xp_per_min: [{ percentile: 0.5, value: 700 }, { percentile: 0.9, value: 900 }],
    hero_healing_per_min: [{ percentile: 0.5, value: 0 }],
    kills_per_min: [{ percentile: 0.5, value: 0.2 }],
    hero_damage_per_min: [{ percentile: 0.5, value: 600 }, { percentile: 0.9, value: 900 }],
    bogus: [{ percentile: 0.5, value: 1 }],
    last_hits_per_min: [{ percentile: "x", value: 1 }],
  },
};

Deno.test("reads benchmark points and drops broken stats", () => {
  const b = readHeroBenchmarks(raw);
  assertEquals(b.gold_per_min?.length, 4);
  assertEquals(b.last_hits_per_min, undefined);
  assertEquals(Object.keys(b).includes("bogus"), false);
  assertEquals(readHeroBenchmarks(null), {});
});

Deno.test("interpolates between points and clamps at the ends", () => {
  const points = readHeroBenchmarks(raw).gold_per_min ?? [];
  assertAlmostEquals(percentileOf(points, 493), 0.5);
  assertAlmostEquals(percentileOf(points, 586), 0.7, 0.001);
  assertAlmostEquals(percentileOf(points, 2000), 0.99);
  assertAlmostEquals(percentileOf(points, 156.5), 0.05, 0.001);
  assertEquals(percentileOf([], 100), 0);
});

Deno.test("judges cores on farm and supports on stats less tied to farm", () => {
  const b = readHeroBenchmarks(raw);
  assertEquals(statsFor(1, b), ["gold_per_min", "xp_per_min", "hero_damage_per_min"]);
  assertEquals(statsFor(5, b), ["hero_damage_per_min", "kills_per_min"], "no healing for a hero that does not heal");
  const healer = readHeroBenchmarks({ result: { hero_healing_per_min: [{ percentile: 0.5, value: 150 }] } });
  assertEquals(statsFor(4, healer), ["hero_healing_per_min"]);
});

Deno.test("a strong game needs the average percentile over the position's bar", () => {
  const b = readHeroBenchmarks(raw);
  const strong = judgeByBenchmarks(1, { gold_per_min: 700, xp_per_min: 900, hero_damage_per_min: 900 }, b);
  assertEquals(strong?.isStrong, true);
  const ordinary = judgeByBenchmarks(1, { gold_per_min: 493, xp_per_min: 700, hero_damage_per_min: 600 }, b);
  assertEquals(ordinary?.isStrong, false);
  assertEquals(judgeByBenchmarks(1, {}, {}), null, "no benchmarks");
});
