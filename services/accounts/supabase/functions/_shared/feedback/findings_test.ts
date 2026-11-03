import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import type { HeroCard } from "../report/facts.ts";
import type { Position } from "../trends/games.ts";
import { type Finding, gameFindings, runePattern, trendFindings } from "./findings.ts";
import type { DeathFact, GameSummary, Percentiles } from "./summary.ts";
import { TIPS } from "./tips.ts";

const HEROES: Record<number, string> = { 114: "Monkey King", 25: "Lina", 26: "Lion" };
const names = { hero: (id: number) => HEROES[id] ?? `Hero ${id}` };

const AVERAGE: Percentiles = {
  goldPerMin: 0.5,
  xpPerMin: 0.5,
  lastHitsPerMin: 0.5,
  heroDamagePerMin: 0.5,
  killsPerMin: 0.5,
  deathsPerMin: 0.5,
  assistsPerMin: 0.5,
  deniesPerMin: 0.5,
  heroHealingPerMin: 0.5,
  towerDamage: 0.5,
};

let nextId = 1;
function game(over: Partial<GameSummary> & { pct?: Partial<Percentiles> } = {}): GameSummary {
  const { pct, ...rest } = over;
  return {
    version: 1,
    factsVersion: 1,
    matchId: nextId++,
    startTime: 0,
    heroId: 114,
    position: 1 as Position,
    isWin: true,
    durationS: 2400,
    isParsed: true,
    // Only deaths is read from the card.
    card: { deaths: 5 } as HeroCard,
    lastHitsAt10: 50,
    deniesAt10: 5,
    laneNetWorthDiffAt10: 0,
    percentiles: { ...AVERAGE, ...pct },
    stunsPerMin: null,
    deaths: [],
    ...rest,
  };
}
const death = (time: number, over: Partial<DeathFact> = {}): DeathFact => ({
  time,
  goldLost: 100,
  timeDead: 25,
  killerHeroId: 25,
  isKillerFromMid: true,
  buildingsLost: [],
  ...over,
});
const tones = (fs: Finding[]) => fs.map((f) => `${f.tone}:${f.kind}`);

Deno.test("strong farm over 6 games is a strength, explained with the player's numbers", () => {
  const games = Array.from({ length: 6 }, () => game({ pct: { goldPerMin: 0.85, lastHitsPerMin: 0.8 } }));
  const [farm] = trendFindings(games, names);
  assertEquals(farm?.headline, "Strong farm");
  assertEquals(
    farm?.pattern,
    "Across 6 games on Monkey King, you had higher farm (GPM and last hits) than 83% " +
      "of games on these heroes on OpenDota (all ranks).",
  );
  assertEquals(farm?.change, null, "strengths get no tip");
  assertEquals(farm?.happened.length, 6);
});

Deno.test("many deaths is a problem with a tip, and few deaths a strength", () => {
  const many = trendFindings(Array.from({ length: 5 }, () => game({ pct: { deathsPerMin: 0.8 } })), names);
  assertEquals(tones(many), ["problem:deaths"]);
  assertEquals(many[0]?.headline, "Too many deaths");
  assertStringIncludes(many[0]?.change ?? "", "You died about 5 times per game.");
  const few = trendFindings(Array.from({ length: 5 }, () => game({ pct: { deathsPerMin: 0.2 } })), names);
  assertEquals(tones(few), ["strength:deaths"]);
  assertStringIncludes(few[0]?.pattern ?? "", "fewer deaths per minute than 80%");
});

Deno.test("needs 4 games and a 15 point gap", () => {
  assertEquals(trendFindings(Array.from({ length: 3 }, () => game({ pct: { heroDamagePerMin: 0.95 } })), names), []);
  assertEquals(trendFindings(Array.from({ length: 6 }, () => game({ pct: { heroDamagePerMin: 0.6 } })), names), []);
});

Deno.test("farm and tower damage are judged for cores only", () => {
  const supports = Array.from(
    { length: 6 },
    () => game({ position: 5, pct: { goldPerMin: 0.1, lastHitsPerMin: 0.1, towerDamage: 0.1 } }),
  );
  assertEquals(trendFindings(supports, names), []);
});

Deno.test("early deaths after power runes to the enemy mid are named as rotations", () => {
  const games = Array.from({ length: 4 }, () => game({ deaths: [death(6 * 60 + 20), death(8 * 60 + 30)] }));
  const early = trendFindings(games, names).find((f) => f.kind === "early_deaths");
  assertEquals(
    early?.pattern,
    "8 of your 8 early deaths came after a power rune spawn (6:00, 8:00), " +
      "with the enemy mid getting the kill.",
  );
  assertEquals(early?.happened[0], "Monkey King: died at 6:20 to Lina (100 gold lost, 25s dead)");
  assertStringIncludes(early?.change ?? "", "Most early deaths came from Lina.");
});

Deno.test("rune rotations need 3 deaths making up 60% of early deaths", () => {
  assertEquals(runePattern([death(380), death(500)]), null, "only 2");
  assertEquals(runePattern([death(380), death(500), death(620), death(300), death(200), death(100)]), null, "3 of 6");
  assertEquals(runePattern([death(380), death(500), death(620, { isKillerFromMid: false })]), null);
  assertEquals(runePattern([death(380), death(500), death(620), death(300)]) !== null, true, "3 of 4");
});

Deno.test("win % with and without the habit needs 5 games each side and a 30 point gap", () => {
  const gank = { isKillerFromMid: false };
  const lost = Array.from({ length: 8 }, () => game({ isWin: false, deaths: [death(300, gank), death(500, gank)] }));
  const won = Array.from({ length: 5 }, () => game({ isWin: true }));
  const early = trendFindings([...lost, ...won], names).find((f) => f.kind === "early_deaths");
  assertStringIncludes(
    early?.cost ?? "",
    "In your games with a death before 10 minutes you won 0%; in the others 100%.",
  );
  const fewWins = trendFindings([...lost, ...won.slice(0, 4)], names).find((f) => f.kind === "early_deaths");
  assertEquals(fewWins?.cost?.includes("In your games"), false, "only 4 games without");
});

Deno.test("one game: a lost lane and two early deaths, and nothing for an ordinary game", () => {
  const bad = game({ laneNetWorthDiffAt10: -1400, deaths: [death(200), death(450)] });
  assertEquals(tones(gameFindings(bad, names)).sort(), ["problem:early_deaths", "problem:laning"]);
  const lane = gameFindings(bad, names).find((f) => f.kind === "laning");
  assertEquals(lane?.happened, [
    "Monkey King: -1400 gold against your lane opponent at 10:00, 50 last hits and 5 denies",
  ]);
  assertEquals(gameFindings(game({ pct: { heroDamagePerMin: 0.7 } }), names), [], "a 20 point gap is not enough");
});

Deno.test("every tip shown comes from the reviewed set", () => {
  const games = [
    ...Array.from(
      { length: 6 },
      () =>
        game({
          pct: { deathsPerMin: 0.9, goldPerMin: 0.1, lastHitsPerMin: 0.1 },
          laneNetWorthDiffAt10: -900,
          deaths: [death(300)],
        }),
    ),
  ];
  const changes = [...trendFindings(games, names), ...gameFindings(games[0]!, names)]; // Safe: games has 6 entries..flatMap((f) => f.change ?? []);
  assertEquals(changes.length > 0, true);
  const templates = Object.values(TIPS).flatMap((byRole) => Object.values(byRole));
  const asRegex = (t: string) => new RegExp(`^${t.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{\w+\}/g, ".+")}$`);
  for (const text of changes) assertEquals(templates.some((t) => asRegex(t).test(text)), true, text);
});
