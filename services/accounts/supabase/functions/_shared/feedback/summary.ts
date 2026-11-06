/**
 * One player's game, boiled down to what game feedback needs: the report's hero card plus
 * laning at 10 minutes, benchmark percentiles, and each death with its killer and what the
 * team lost while the player was dead. Pure: no network or database. Saved per player and
 * match (player_game_facts), so feedback pages never fetch the match again.
 */
import { buildFacts, FACTS_VERSION, type HeroCard, type ItemCost } from "../report/facts.ts";
import { isRadiantSlot, type Match, type MatchPlayer } from "../report/match.ts";
import type { Position } from "../trends/games.ts";

/** Bump with any change to GameSummary's shape, and keep readers able to read older ones. */
export const SUMMARY_VERSION = 1;
const LANE_MINUTE = 10;
const HERO_KEY_PREFIX = "npc_dota_hero_";

/** Percentiles (0 to 1) against everyone playing the hero on OpenDota (all ranks and positions). */
export interface Percentiles {
  goldPerMin: number;
  xpPerMin: number;
  lastHitsPerMin: number;
  heroDamagePerMin: number;
  killsPerMin: number | null;
  /** OpenDota flips this one: a high percentile means fewer deaths than most games. */
  deathsPerMin: number | null;
  assistsPerMin: number | null;
  deniesPerMin: number | null;
  heroHealingPerMin: number | null;
  towerDamage: number | null;
}

export interface DeathFact {
  /** Seconds from the horn. */
  time: number;
  goldLost: number;
  timeDead: number;
  /** The hero that landed the killing blow, or null for creeps, towers and neutrals. */
  killerHeroId: number | null;
  /** True when the killer laned mid and this player did not (a rotation); null when lanes are unknown. */
  isKillerFromMid: boolean | null;
  /** The team's buildings destroyed while this player was dead, by OpenDota key. */
  buildingsLost: string[];
}

export interface GameSummary {
  version: typeof SUMMARY_VERSION;
  factsVersion: typeof FACTS_VERSION;
  matchId: number;
  /** Unix seconds. */
  startTime: number;
  heroId: number;
  position: Position | null;
  isWin: boolean;
  durationS: number;
  /** False when OpenDota hadn't parsed the replay: the parsed only fields below are null. */
  isParsed: boolean;
  card: HeroCard;
  lastHitsAt10: number | null;
  deniesAt10: number | null;
  /** This player's net worth at 10 minutes minus the richest enemy in the same lane. */
  laneNetWorthDiffAt10: number | null;
  percentiles: Percentiles | null;
  stunsPerMin: number | null;
  deaths: DeathFact[] | null;
}

export interface SummaryInput {
  match: Match;
  accountId: number;
  startTime: number;
  position: Position | null;
  /** Item key to id and cost, as reports use, for key item timings. */
  items: Record<string, ItemCost>;
  /** Hero unit key ("npc_dota_hero_lina") to hero id, from OpenDota's hero constants. */
  heroIdsByKey: Record<string, number>;
}

/** The player's summary, or null when the account isn't in the match. */
export function summarizeGame({ match, accountId, startTime, position, items, heroIdsByKey }: SummaryInput):
  | GameSummary
  | null {
  const me = match.players.find((p) => p.accountId === accountId);
  if (!me) return null;
  const isRadiant = isRadiantSlot(me.playerSlot);
  const card = buildFacts(match, isRadiant, items).heroes.find((h) => h.heroId === me.heroId);
  if (!card) return null;
  const enemies = match.players.filter((p) => isRadiantSlot(p.playerSlot) !== isRadiant);
  const minutes = match.durationS / 60;
  const hasLane = match.isParsed && match.durationS >= LANE_MINUTE * 60;

  return {
    version: SUMMARY_VERSION,
    factsVersion: FACTS_VERSION,
    matchId: match.matchId,
    startTime,
    heroId: me.heroId,
    position,
    isWin: match.radiantWin === isRadiant,
    durationS: match.durationS,
    isParsed: match.isParsed,
    card,
    lastHitsAt10: hasLane ? me.lastHitsByMinute?.[LANE_MINUTE] ?? null : null,
    deniesAt10: hasLane ? me.deniesByMinute?.[LANE_MINUTE] ?? null : null,
    laneNetWorthDiffAt10: hasLane ? laneDiff(me, enemies) : null,
    percentiles: percentilesOf(me),
    stunsPerMin: me.stunSeconds === null ? null : me.stunSeconds / minutes,
    deaths: match.isParsed ? deathsOf(me, enemies, isRadiant, match, heroIdsByKey) : null,
  };
}

function laneDiff(me: MatchPlayer, enemies: MatchPlayer[]): number | null {
  const mine = me.netWorthByMinute?.[LANE_MINUTE];
  if (mine === undefined || me.lane === null || me.lane === 4 || me.isRoaming) return null;
  const rivals = enemies
    .filter((p) => p.lane === me.lane && p.isRoaming !== true)
    .map((p) => p.netWorthByMinute?.[LANE_MINUTE])
    .filter((w): w is number => w !== undefined);
  return rivals.length ? mine - Math.max(...rivals) : null;
}

function percentilesOf(p: MatchPlayer): Percentiles | null {
  if (!p.benchmarks) return null;
  const other = p.otherBenchmarks;
  return {
    ...p.benchmarks,
    killsPerMin: other?.killsPerMin ?? null,
    deathsPerMin: other?.deathsPerMin ?? null,
    assistsPerMin: other?.assistsPerMin ?? null,
    deniesPerMin: other?.deniesPerMin ?? null,
    heroHealingPerMin: other?.heroHealingPerMin ?? null,
    towerDamage: other?.towerDamage ?? null,
  };
}

function deathsOf(
  me: MatchPlayer,
  enemies: MatchPlayer[],
  isRadiant: boolean,
  match: Match,
  heroIdsByKey: Record<string, number>,
): DeathFact[] | null {
  if (!me.deathsLog) return null;
  // Our buildings: Radiant's are "goodguys", Dire's "badguys".
  const ourBuildings = isRadiant ? "npc_dota_goodguys_" : "npc_dota_badguys_";
  return me.deathsLog.map((d) => {
    const killerHeroId = d.killer?.startsWith(HERO_KEY_PREFIX) ? heroIdsByKey[d.killer] ?? null : null;
    const killer = killerHeroId === null ? undefined : enemies.find((p) => p.heroId === killerHeroId);
    const isKillerFromMid = !killer || killer.lane === null || me.lane === null
      ? null
      : killer.lane === 2 && me.lane !== 2;
    const buildingsLost = (match.buildingKills ?? [])
      .filter((b) => b.key.startsWith(ourBuildings) && b.time >= d.time && b.time <= d.time + d.timeDead)
      .map((b) => b.key);
    return { time: d.time, goldLost: d.goldLost, timeDead: d.timeDead, killerHeroId, isKillerFromMid, buildingsLost };
  });
}
