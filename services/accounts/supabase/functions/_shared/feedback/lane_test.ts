import { assertEquals } from "jsr:@std/assert@1";
import { readOpenDotaMatch } from "../report/match.ts";
import { gameFindings } from "./findings.ts";
import { farmDetail, farmLines, laneDetail, laneFinding } from "./lane.ts";
import { summarizeGame } from "./summary.ts";

const HEROES: Record<number, string> = { 35: "Sniper", 92: "Visage", 135: "Dawnbreaker" };
const names = { hero: (id: number) => HEROES[id] ?? `Hero ${id}` };
const raw = () => JSON.parse(Deno.readTextFileSync(new URL("./fixtures/ursa-9073776545.json", import.meta.url)));
const ursaMatch = () => readOpenDotaMatch(raw());
// Ursa (account 1000, Radiant) laned against Visage and Dawnbreaker and was 526 gold behind at 10:00.
const ursa = () => {
  const s = summarizeGame({
    match: ursaMatch(),
    accountId: 1000,
    startTime: 0,
    position: 1,
    items: {},
    heroIdsByKey: { npc_dota_hero_visage: 92, npc_dota_hero_sniper: 35 },
  });
  if (!s) throw new Error("no summary");
  return s;
};

Deno.test("the lane card names the rivals, the numbers at 10:00 and when the gap opened", () => {
  const lane = laneFinding(ursa(), names, 500);
  assertEquals(lane?.headline, "Lost Your Lane to Visage and Dawnbreaker");
  assertEquals(lane?.happened, [
    "10:00: you had 68 last hits and 3,993 net worth; Visage had 11 last hits and 2,004 net worth, " +
    "Dawnbreaker had 57 last hits and 4,519 net worth.",
    "The gap first reached 500 gold at 8:00 and was 526 at 10:00.",
  ]);
  assertEquals(lane?.cost, "Your death before 10:00 (4:32 to Visage) gave the enemy 295 gold.");
  assertEquals(lane?.change, null);
  assertEquals(laneFinding(ursa(), names, 1000), null, "a single game needs a 1,000 gold gap");
});

Deno.test("a lane with no deaths says so, and a won lane is a strength", () => {
  const s = ursa();
  // Safe: the Ursa game has a lane with two rivals (checked in the test above).
  const lane = s.lane!;
  // Swap sides: the player is Dawnbreaker's numbers, the rival is Ursa's.
  const won = { ...s, deaths: [], lane: { me: { ...lane.rivals[1]!, heroId: 70 }, rivals: [lane.me] } };
  const found = laneFinding(won, names, 500);
  assertEquals([found?.tone, found?.headline, found?.cost], ["strength", "Won Your Lane Against Hero 70", null]);
  const lost = laneFinding({ ...s, deaths: [] }, names, 500);
  assertEquals(lost?.cost, "You didn't die before 10:00.");
});

Deno.test("no lane detail in the jungle, roaming, or an unknown lane", () => {
  const match = ursaMatch();
  // Safe: a match always has ten players.
  const me = match.players[0]!;
  const enemies = match.players.slice(5);
  assertEquals(laneDetail(me, enemies)?.rivals.map((r) => r.heroId), [92, 135]);
  assertEquals(laneDetail({ ...me, lane: 4 }, enemies), null);
  assertEquals(laneDetail({ ...me, isRoaming: true }, enemies), null);
  assertEquals(laneDetail({ ...me, lane: null }, enemies), null);
  assertEquals(laneDetail(me, enemies.map((p) => ({ ...p, lane: 3 }))), null, "nobody laned against them");
});

Deno.test("farm is shown every 10 minutes next to the enemy's best farmer", () => {
  assertEquals(farmLines(ursa(), names), [
    "Your last hits: 68 at 10:00, 204 at 20:00, 286 at 30:00, 368 at 40:00.",
    "Sniper, the enemy with the most last hits: 53 at 10:00, 153 at 20:00, 262 at 30:00, 375 at 40:00.",
  ]);
  const match = ursaMatch();
  assertEquals(farmDetail(match.players[0]!, match.players.slice(5), 9 * 60), null, "shorter than 10 minutes");
  assertEquals(farmDetail({ ...match.players[0]!, lastHitsByMinute: null }, match.players.slice(5), 2400), null);
});

Deno.test("the game's farm card keeps the percentile and adds this game's last hits", () => {
  const farm = gameFindings(ursa(), names).find((f) => f.kind === "farm");
  assertEquals(farm?.happened, [
    "Hero 70: more farm (GPM and last hits) than 86% of Hero 70 games",
    "Your last hits: 68 at 10:00, 204 at 20:00, 286 at 30:00, 368 at 40:00.",
    "Sniper, the enemy with the most last hits: 53 at 10:00, 153 at 20:00, 262 at 30:00, 375 at 40:00.",
  ]);
});

Deno.test("an unparsed game has no lane or farm detail", () => {
  const s = summarizeGame({
    match: readOpenDotaMatch({ ...raw(), version: null }),
    accountId: 1000,
    startTime: 0,
    position: 1,
    items: {},
    heroIdsByKey: {},
  });
  assertEquals([s?.lane, s?.farm], [null, null]);
});
