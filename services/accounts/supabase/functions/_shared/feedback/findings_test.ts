import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import type { HeroCard } from "../report/facts.ts";
import type { Position } from "../trends/games.ts";
import { clock, type Finding, gameFindings, ordinal, rotationPattern, trendFindings } from "./findings.ts";
import type { DeathFact, GameSummary, Percentiles } from "./summary.ts";

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
    "Across 6 games on Monkey King, you had more farm (GPM and last hits) than 83% " +
      "of games on these heroes on OpenDota (all ranks).",
  );
  assertEquals(farm?.change, null, "strengths get no tip");
  assertEquals(farm?.happened.length, 6);
});

Deno.test("many deaths is a problem with no fixed tip, and few deaths a strength", () => {
  // OpenDota flips deaths: a low percentile means more deaths than most games.
  const many = trendFindings(Array.from({ length: 5 }, () => game({ pct: { deathsPerMin: 0.2 } })), names);
  assertEquals(tones(many), ["problem:deaths"]);
  assertEquals(many[0]?.headline, "Too many deaths");
  assertStringIncludes(many[0]?.pattern ?? "", "more deaths per minute than 80%");
  assertEquals(many[0]?.change, null, "no generic advice");
  const few = trendFindings(Array.from({ length: 5 }, () => game({ pct: { deathsPerMin: 0.8 } })), names);
  assertEquals(tones(few), ["strength:deaths"]);
  assertStringIncludes(few[0]?.pattern ?? "", "fewer deaths per minute than 80%");
});

Deno.test("Can's Sven game, 9/1/14 in 34 minutes, is a strength for deaths, not a problem", () => {
  // OpenDota benchmarks of match 9074154178: deaths_per_min raw 0.0296, pct 0.956.
  const sven = game({
    heroId: 18,
    position: 1,
    card: { kills: 9, deaths: 1, assists: 14 } as HeroCard,
    pct: {
      goldPerMin: 0.546,
      xpPerMin: 0.313,
      lastHitsPerMin: 0.699,
      heroDamagePerMin: 0.665,
      deathsPerMin: 0.956,
      towerDamage: 0.558,
    },
    laneNetWorthDiffAt10: 2136,
  });
  const found = gameFindings(sven, { hero: (id) => (id === 18 ? "Sven" : `Hero ${id}`) });
  assertEquals(tones(found).sort(), ["strength:deaths", "strength:laning"]);
  const deaths = found.find((f) => f.kind === "deaths");
  assertEquals(deaths?.headline, "You stay alive");
  assertEquals(deaths?.happened, ["Sven: fewer deaths per minute than 96% of Sven games"]);
  assertEquals(deaths?.pattern, null, "one game says it in its own line");
  assertEquals(deaths?.change, null);
});

Deno.test("with fight data, a game's deaths are judged by fight, not by the deaths percentile", () => {
  const fight = { startS: 600, endS: 600, ourDeaths: 2, theirDeaths: 3, label: "close_win" as const };
  const bad = game({ version: 2, pct: { deathsPerMin: 0.1 }, deaths: [death(600, { fight, goldFed: 300 })] });
  assertEquals(gameFindings(bad, names), [], "a close win is never a problem");
  const v1 = gameFindings(game({ pct: { deathsPerMin: 0.1 } }), names);
  assertEquals([tones(v1), v1[0]?.change], [["problem:deaths"], null], "an older summary: the fact, no tip");
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

Deno.test("early deaths to a killer from another lane after a power rune are named as rotations", () => {
  const rotation = { isKillerFromOtherLane: true, didKillerTakeRune: true };
  const games = Array.from({ length: 4 }, () => game({ deaths: [death(6 * 60 + 20, rotation), death(8 * 60 + 30)] }));
  const early = trendFindings(games, names).find((f) => f.kind === "early_deaths");
  assertEquals(early?.pattern, "You died 8 times before 10 minutes in 4 of your last 4 games.", "4 of 8 is not 60%");
  assertEquals(early?.happened[0], "Monkey King: died at 6:20 to Lina (100 gold lost, 25s dead)");
  assertEquals(early?.change, null, "no fixed tip");
  const all = Array.from({ length: 4 }, () => game({ deaths: [death(380, rotation), death(500, rotation)] }));
  assertEquals(
    trendFindings(all, names).find((f) => f.kind === "early_deaths")?.pattern,
    "8 of your 8 early deaths came from a hero who left another lane after taking a power rune (Lina).",
  );
});

Deno.test("rotations need 3 deaths making up 60% of early deaths, and both facts known", () => {
  const r = { isKillerFromOtherLane: true, didKillerTakeRune: true };
  assertEquals(rotationPattern([death(380, r), death(500, r)], names), null, "only 2");
  assertEquals(
    rotationPattern([death(380, r), death(500, r), death(520, r), death(300), death(200), death(100)], names),
    null,
    "3 of 6",
  );
  assertEquals(
    rotationPattern([death(380, r), death(500, r), death(620, { ...r, didKillerTakeRune: null })], names),
    null,
  );
  assertEquals(rotationPattern([death(380, r), death(500, r), death(620, r), death(300)], names) !== null, true);
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

Deno.test("no finding carries a fixed tip", () => {
  const games = Array.from(
    { length: 6 },
    () =>
      game({
        pct: { deathsPerMin: 0.1, goldPerMin: 0.1, lastHitsPerMin: 0.1 },
        laneNetWorthDiffAt10: -1200,
        deaths: [death(300), death(400)],
      }),
  );
  // Safe: games has 6 entries.
  const found = [...trendFindings(games, names), ...gameFindings(games[0]!, names)];
  assertEquals(found.length > 0, true);
  assertEquals(found.flatMap((f) => f.change ?? []), []);
});

Deno.test("percentiles read as English ordinals", () => {
  assertEquals([1, 2, 3, 4, 11, 12, 13, 21, 22, 82, 100].map(ordinal), [
    "1st",
    "2nd",
    "3rd",
    "4th",
    "11th",
    "12th",
    "13th",
    "21st",
    "22nd",
    "82nd",
    "100th",
  ]);
});

Deno.test("the game clock reads right before the horn", () => {
  assertEquals([clock(-106), clock(-46), clock(0), clock(272), clock(3600)], [
    "-1:46",
    "-0:46",
    "0:00",
    "4:32",
    "60:00",
  ]);
});
