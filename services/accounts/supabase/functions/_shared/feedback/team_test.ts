import { assertEquals } from "jsr:@std/assert@1";
import type { Position } from "../trends/games.ts";
import { readOpenDotaMatch } from "../report/match.ts";
import { gameFindings } from "./findings.ts";
import { summarizeGame } from "./summary.ts";
import { teamLines } from "./team.ts";

const HEROES: Record<number, string> = { 18: "Sven", 26: "Lion", 36: "Necrophos", 71: "Spirit Breaker", 74: "Invoker" };
const names = { hero: (id: number) => HEROES[id] ?? `Hero ${id}` };
const raw = () => JSON.parse(Deno.readTextFileSync(new URL("./fixtures/sven-9073477575.json", import.meta.url)));

// Dire in the Sven game: Sven (1005), Spirit Breaker (1006), Hero 81 (1007), Lion (1008), Hero 19 (1009).
function summary(accountId: number, position: Position, parsed = true) {
  const s = summarizeGame({
    match: readOpenDotaMatch(parsed ? raw() : { ...raw(), version: null }),
    accountId,
    startTime: 0,
    position,
    items: {},
    heroIdsByKey: {},
  });
  if (!s) throw new Error("no summary");
  return s;
}

Deno.test("the damage card puts the player next to both sides in this game", () => {
  const damage = gameFindings(summary(1005, 1), names).find((f) => f.kind === "damage");
  assertEquals(damage?.headline, "High Hero Damage");
  assertEquals(damage?.happened, [
    "Sven: more hero damage per minute than 99% of Sven games",
    "Your hero damage: 85,372, 40% of your side's, 1st of 5.",
    "Most on the enemy side: Necrophos with 85,205.",
    "You took part in 78% of your side's kills.",
  ]);
  assertEquals(damage?.change, null);
});

Deno.test("a player who wasn't first on their side sees who was", () => {
  assertEquals(teamLines(summary(1008, 5), "damage", names)?.slice(0, 2), [
    "Your hero damage: 18,362, 9% of your side's, 5th of 5.",
    "Most on your side: Sven with 85,372.",
  ]);
  assertEquals(
    teamLines(summary(1008, 5), "towers", names)?.[0],
    "Your tower damage: 2,143, 8% of your side's, 4th of 5.",
  );
  assertEquals(teamLines(summary(1008, 5), "laning", names), null, "only damage, towers and healing");
});

Deno.test("healing is judged for supports who healed someone, against the same hero", () => {
  const breaker = summary(1006, 4);
  // Safe: a parsed match has percentiles.
  const low = { ...breaker, percentiles: { ...breaker.percentiles!, heroHealingPerMin: 0.1 } };
  const healing = gameFindings(low, names).find((f) => f.kind === "healing");
  assertEquals(healing?.headline, "Low Healing");
  assertEquals(healing?.happened, [
    "Spirit Breaker: less healing per minute than 90% of Spirit Breaker games",
    "Your healing: 32, 100% of your side's, 1st of 5.",
    "Most on the enemy side: Necrophos with 4,738.",
  ]);
  // Lion healed nobody, so OpenDota's 80th percentile for its 0 healing says nothing.
  assertEquals(gameFindings(summary(1008, 5), names).some((f) => f.kind === "healing"), false);
  const core = { ...low, position: 1 as Position };
  assertEquals(gameFindings(core, names).some((f) => f.kind === "healing"), false, "cores are not judged on healing");
});

Deno.test("an unparsed game still has every hero's totals", () => {
  assertEquals(summary(1005, 1, false).team?.ours.map((h) => h.heroId), [18, 71, 81, 26, 19]);
});
