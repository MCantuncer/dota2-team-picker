/**
 * One game's death feedback, worked out from that game alone: who killed the player, in which
 * fight, what it cost, and what the map looked like. Every line names this game's minutes,
 * heroes and numbers. No line of advice: the game data can't show what would have saved a
 * fight, so the cards say what happened and leave it there. Pure: no network or database.
 */
import type { Finding, Names } from "./findings.ts";
import type { FightScore } from "./fights.ts";
import type { DeathFact, GameSummary } from "./summary.ts";

/** At or above this percentile the player died less than most players on the hero: only a costly death shows. */
const STOMP_DEATHS_PCT = 0.75;
/** A single death costs enough to show alone with this much gold fed, or a building lost. */
const COSTLY_GOLD = 1500;
/** Rotations are only named in the laning stage. */
const ROTATION_BEFORE_S = 12 * 60;
/** A repeat killer needs this many kills and more than half of the deaths. */
const REPEAT_KILLS = 3;
/** Ranking: caught alone first, then lost fights, then the costliest death, above other findings. */
const SCORE = { caughtAlone: 3, lostFights: 2, costliest: 1, goodTrades: 1 } as const;

/** A death with its fight known (version 2 summaries). */
type ScoredDeath = DeathFact & { fight: FightScore };

const gold = (n: number) => n.toLocaleString("en-US");
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const fed = (d: DeathFact) => d.goldFed ?? 0;
const isCostly = (d: DeathFact) => fed(d) >= COSTLY_GOLD || d.buildingsLost.length > 0;

/** Game clock: "6:20", and "-0:46" before the horn. */
export function clock(s: number): string {
  const t = Math.floor(Math.abs(s));
  return `${s < 0 ? "-" : ""}${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

const LANES: Record<string, string> = { top: "Top", mid: "Mid", bot: "Bottom" };

/**
 * "npc_dota_goodguys_tower2_top" reads "Tier 2 Top Tower"; barracks and the Ancient likewise.
 * The same names as the site's deaths list (web src/lib/player-game.ts buildingName).
 */
export function buildingName(key: string): string {
  const name = key.replace(/^npc_dota_(goodguys|badguys)_/, "");
  const tower = /^tower(\d)(?:_(top|mid|bot))?$/.exec(name);
  if (tower) return tower[2] ? `Tier ${tower[1]} ${LANES[tower[2]]} Tower` : `Tier ${tower[1]} Tower`;
  const rax = /^(range|melee)_rax_(top|mid|bot)$/.exec(name);
  if (rax) return `${LANES[rax[2] ?? ""]} ${rax[1] === "range" ? "Ranged" : "Melee"} Barracks`;
  return name === "fort" ? "Ancient" : name.replace(/_/g, " ");
}

/** "your Tier 2 Top Tower" or "your Tier 2 Top Tower and Tier 1 Mid Tower"; null when nothing fell. */
function buildings(d: DeathFact): string | null {
  const names = d.buildingsLost.map(buildingName);
  if (!names.length) return null;
  return `your ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`}`;
}

/** "your Tier 2 Top Tower fell while you were dead 46 seconds", or null. */
function fell(d: DeathFact): string | null {
  const lost = buildings(d);
  return lost ? `${lost} fell while you were dead ${d.timeDead} seconds` : null;
}

function wards(d: DeathFact): string | null {
  if (!d.wardsUp) return null;
  const { ours, theirs } = d.wardsUp;
  return `Your side had ${ours} observer${ours === 1 ? "" : "s"} up anywhere on the map, theirs had ${theirs}.`;
}

function killer(d: DeathFact, names: Names): string | null {
  return d.killerHeroId === null ? null : names.hero(d.killerHeroId);
}

/** The game's death findings. Empty when the summary has no fight data (version 1). */
export function deathFindings(game: GameSummary, names: Names): Finding[] {
  const deaths = (game.deaths ?? []).filter((d): d is ScoredDeath => !!d.fight);
  if (!deaths.length) return [];
  const ids = [game.matchId];
  const deathsPct = game.percentiles?.deathsPerMin ?? null;
  if (deathsPct !== null && deathsPct >= STOMP_DEATHS_PCT) {
    const costly = costliest(deaths, names, ids, isCostly);
    return costly ? [costly] : [];
  }
  const found = [caughtAlone(deaths, names, ids), lostFights(deaths, names, ids), goodTrades(deaths, ids)];
  // The costliest death gets its own card when no card above already shows it.
  const costly = costliest(deaths, names, ids, (d) => d.fight.label === "even_trade" && isCostly(d));
  return [...found, costly].filter((f): f is Finding => f !== null);
}

function caughtAlone(deaths: ScoredDeath[], names: Names, ids: number[]): Finding | null {
  const alone = deaths.filter((d) => d.fight.label === "caught_alone");
  if (!alone.length) return null;
  const happened = alone.map((d) => {
    const by = killer(d, names);
    const what = d.time < 0
      ? `${by ?? "The enemy"} got first blood on you before the horn.`
      : `${by ?? "The enemy"} killed you with no fight around (1 for 0)${rotation(d, by)}.`;
    return [`${clock(d.time)}: ${what}`, wards(d), capitalize(fell(d))].filter(Boolean).join(" ");
  });
  return {
    kind: "deaths",
    tone: "problem",
    score: SCORE.caughtAlone + alone.length / 10,
    headline: alone.length === 1 ? "Caught Alone" : `Caught Alone ${alone.length} Times`,
    happened,
    pattern: repeatKiller(deaths, names),
    cost: costLine(alone, names),
    change: null,
    matchIds: ids,
  };
}

function lostFights(deaths: ScoredDeath[], names: Names, ids: number[]): Finding | null {
  const lost = deaths.filter((d) => d.fight.label === "lost_fight");
  if (!lost.length) return null;
  const happened = lost.map((d) => {
    const start = d.fight.startS < d.time ? ` (the fight started at ${clock(d.fight.startS)})` : "";
    const by = killer(d, names);
    const parts = [
      `${clock(d.time)}: your side lost ${d.fight.ourDeaths} for ${d.fight.theirDeaths}${start}`,
      by ? `${by} got the kill on you` : null,
      fell(d),
    ];
    return `${parts.filter(Boolean).join(", ")}.`;
  });
  return {
    kind: "deaths",
    tone: "problem",
    score: SCORE.lostFights + lost.length / 10,
    headline: lost.length === 1 ? "Lost Fight" : `${lost.length} Lost Fights`,
    happened,
    pattern: null,
    cost: costLine(lost, names),
    change: null,
    matchIds: ids,
  };
}

function goodTrades(deaths: ScoredDeath[], ids: number[]): Finding | null {
  const good = deaths.filter((d) => d.fight.label === "good_trade");
  if (!good.length) return null;
  return {
    kind: "deaths",
    tone: "strength",
    score: SCORE.goodTrades + good.length / 10,
    headline: "Good Trades",
    happened: good.map((d) =>
      `${clock(d.time)}: you died, and your side won the fight ${d.fight.ourDeaths} for ${d.fight.theirDeaths}.`
    ),
    pattern: null,
    cost: null,
    change: null,
    matchIds: ids,
  };
}

/** The single death that fed the most gold, when `isWorthShowing` says it cost enough. */
function costliest(
  deaths: ScoredDeath[],
  names: Names,
  ids: number[],
  isWorthShowing: (d: ScoredDeath) => boolean,
): Finding | null {
  const worst = [...deaths].sort((a, b) => fed(b) - fed(a))[0];
  if (!worst || !isWorthShowing(worst)) return null;
  const by = killer(worst, names);
  const fight = worst.fight.label === "caught_alone"
    ? "with no fight around (1 for 0)"
    : `in a fight your side ${verb(worst)} ${worst.fight.ourDeaths} for ${worst.fight.theirDeaths}`;
  const lost = buildings(worst);
  const happened = `${clock(worst.time)}: ${by ?? "The enemy"} killed you ${fight}. You were dead ${worst.timeDead} ` +
    `seconds${lost ? ` and ${lost} fell` : ""}.`;
  const others = deaths.filter((d) => d !== worst);
  const othersFed = sum(others.map(fed));
  const compare = !others.length
    ? ""
    : fed(worst) >= othersFed
    ? `, more than your other ${others.length === 1 ? "death" : `${others.length} deaths together`} (${
      gold(othersFed)
    })`
    : fed(worst) >= othersFed * 0.9
    ? `, almost as much as your other ${others.length} deaths together (${gold(othersFed)})`
    : "";
  return {
    kind: "deaths",
    tone: "problem",
    score: SCORE.costliest,
    headline: "Costliest Death",
    happened: [happened],
    pattern: null,
    cost: `${gold(fed(worst))} gold to ${by ?? "the enemy"}${compare}.`,
    change: null,
    matchIds: ids,
  };
}

function verb(d: ScoredDeath): string {
  return d.fight.ourDeaths > d.fight.theirDeaths
    ? "lost"
    : d.fight.ourDeaths === d.fight.theirDeaths
    ? "traded"
    : "won";
}

/** " after taking a power rune in another lane", only in the laning stage and with both facts known. */
function rotation(d: DeathFact, by: string | null): string {
  if (!by || d.time >= ROTATION_BEFORE_S) return "";
  return d.isKillerFromOtherLane === true && d.didKillerTakeRune === true
    ? `; ${by} came from another lane and took a power rune in the minute before`
    : "";
}

/** "Legion Commander got 4 of your 7 deaths", only with 3 or more and more than half. */
function repeatKiller(deaths: DeathFact[], names: Names): string | null {
  const counts = new Map<number, number>();
  for (const d of deaths) {
    if (d.killerHeroId !== null) counts.set(d.killerHeroId, (counts.get(d.killerHeroId) ?? 0) + 1);
  }
  const [hero, kills] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  if (hero === null || kills < REPEAT_KILLS || kills * 2 <= deaths.length) return null;
  return `${names.hero(hero)} got ${kills} of your ${deaths.length} deaths in this game.`;
}

/** "1,102 gold to Nyx Assassin and Legion Commander, 82 seconds dead." */
function costLine(deaths: DeathFact[], names: Names): string {
  const killers = [...new Set(deaths.flatMap((d) => killer(d, names) ?? []))];
  const to = killers.length === 0
    ? ""
    : ` to ${
      killers.length === 1 ? killers[0] : `${killers.slice(0, -1).join(", ")} and ${killers[killers.length - 1]}`
    }`;
  return `${gold(sum(deaths.map(fed)))} gold${to}, ${sum(deaths.map((d) => d.timeDead))} seconds dead.`;
}

function capitalize(s: string | null): string | null {
  return s ? `${s[0]?.toUpperCase()}${s.slice(1)}.` : null;
}
