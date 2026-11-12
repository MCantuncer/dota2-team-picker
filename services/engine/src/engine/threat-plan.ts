/**
 * The game plan against a dangerous enemy hero for one draft (see threat.ts for how the dangerous heroes and
 * their answers are found). It only gathers measured facts for the Draft card and the Game Story: how many of
 * his answers your team has, the open answers for each empty seat, his lane against your laners, when he
 * usually finishes his big item, and his win rate by game length. No advice is made up here.
 *
 * Every dangerous enemy core gets a plan, most dangerous first: the highest win rate against teams with as many of
 * his answers as yours has now (dangerOf), so the order changes as your team picks his answers.
 */
import { LANE_OPPONENTS, guessEnemyPositions, knownPositions } from "./positions";
import { chooseTimingSlice } from "./item-timing-slice";
import type { Engine } from "./score";
import type { StairStep, ThreatPlan } from "./threat";
import { POSITIONS, rankGroup, type AllyPick, type EnemyPositions, type LaneCounts, type Position, type RankBracket } from "./types";

/** A hero counts for a seat when at least this share of his games are played there. */
export const SEAT_SHARE = 0.2;
/** Open answers listed per empty seat. */
export const OPEN_PER_SEAT = 4;
/** Each side of the item pace (early and late) needs this many games. */
export const MIN_PACE_GAMES = 300;
/** Early is done this many minutes or more before his usual minute... */
export const PACE_EARLY = 2;
/** ...late is 1 to this many minutes after it. */
export const PACE_LATE = 3;

/** An answer and the pick engine's own matchup number for him against it (negative: he does worse). */
export interface AnswerEdge {
  hero: number;
  edge: number;
}

/** His record in lane with one of your laners in it, next to his usual lane at the same rank. */
export interface ThreatLane {
  ally: number;
  /** [games, won, drawn, lost] for his whole lane with this ally in it. */
  with: LaneCounts;
  /** [games, won, drawn, lost] for all his lanes. */
  usual: LaneCounts;
}

/** When he finishes his big item, and how those games ended. */
export interface ThreatPace {
  itemId: number;
  /** His usual minute for it (the build's average minute). */
  minute: number;
  /** Games where it was done by `minute - PACE_EARLY`. */
  early: StairStep;
  /** Games where it was done 1 to PACE_LATE minutes after `minute`. */
  late: StairStep;
  /** Every minute: [minute, games, wins], for the chart. */
  minutes: [minute: number, games: number, wins: number][];
}

export interface DraftThreat {
  hero: number;
  /** His likely position, 1 to 3. */
  position: Position;
  plan: ThreatPlan;
  /** His answers on your team. */
  have: AnswerEdge[];
  /** Which stair step your team is on: 0, 1 or 2 (two or more answers). */
  step: 0 | 1 | 2;
  /**
   * Open answers for each empty seat, where the pick engine agrees he does worse against them, worst for him first.
   * Each hero shows once, at the empty seat he is played at most.
   */
  open: { position: Position; heroes: AnswerEdge[] }[];
  lanes: ThreatLane[];
  pace?: ThreatPace;
  /** His win rate by game length, and the pooled position 1 heroes', one step per LENGTH_STEPS entry. */
  length: { his: StairStep[]; group: StairStep[] };
}

export interface DraftThreatsInput {
  allies: AllyPick[];
  enemies: number[];
  enemyPositions?: EnemyPositions;
  bans?: number[];
  rankBracket?: RankBracket;
}

/**
 * A plan for each dangerous enemy core in the draft (likely position 1 to 3), most dangerous first. Empty when
 * the snapshot has no plans or no enemy core qualifies.
 */
export function draftThreats(engine: Engine, input: DraftThreatsInput): DraftThreat[] {
  const plans = engine.data.threatPlans?.plans ?? [];
  if (plans.length === 0 || input.enemies.length === 0) return [];
  const fits = guessEnemyPositions(
    input.enemies.map((e) => engine.fit(e)),
    knownPositions(input.enemies, input.enemyPositions),
  );
  const positionOf = new Map(
    input.enemies.map((e, i) => [e, POSITIONS.reduce((best, p) => (fits[i]![p] > fits[i]![best] ? p : best), 1 as Position)]),
  );
  const allies = input.allies.map((a) => a.heroId);
  const bracket = input.rankBracket;
  const taken = new Set([...allies, ...input.enemies, ...(input.bans ?? [])]);
  const filled = new Set(input.allies.flatMap((a) => (a.position ? [a.position] : [])));
  const seats = allies.length >= 5 ? [] : POSITIONS.filter((p) => !filled.has(p));
  // Each open answer shows once, at the empty seat he is played at most.
  const seatOf = (h: number) => {
    const fit = engine.fit(h);
    const best = seats.reduce<Position | undefined>((b, p) => (b === undefined || fit[p] > fit[b] ? p : b), undefined);
    return best !== undefined && fit[best] >= SEAT_SHARE ? best : undefined;
  };
  const threatOf = (plan: ThreatPlan, position: Position): DraftThreat => {
    const edge = (h: number): AnswerEdge => ({ hero: h, edge: engine.matchupEdge(plan.hero, h, bracket) });
    const answerIds = plan.answers.map((a) => a.hero);
    const have = allies.filter((a) => answerIds.includes(a));
    const candidates = answerIds
      .filter((h) => !taken.has(h) && engine.data.heroes[h])
      .map((h) => ({ ...edge(h), seat: seatOf(h) }))
      .filter((a) => a.seat !== undefined && a.edge < 0)
      .sort((a, b) => a.edge - b.edge);
    const open = seats
      .map((seat) => ({
        position: seat,
        heroes: candidates
          .filter((a) => a.seat === seat)
          .slice(0, OPEN_PER_SEAT)
          .map(({ hero, edge: e }) => ({ hero, edge: e })),
      }))
      .filter((s) => s.heroes.length > 0);
    return {
      hero: plan.hero,
      position,
      plan,
      have: have.map(edge),
      step: Math.min(2, have.length) as 0 | 1 | 2,
      open,
      lanes: threatLanes(engine, plan.hero, position, input.allies, bracket),
      pace: threatPace(engine, plan.hero, position, bracket),
      length: { his: plan.length, group: engine.data.threatPlans?.pos1Length ?? [] },
    };
  };
  return plans
    .flatMap((plan) => {
      const position = positionOf.get(plan.hero);
      return position !== undefined && position <= 3 ? [threatOf(plan, position)] : [];
    })
    .sort((a, b) => dangerOf(b) - dangerOf(a) || b.plan.drop - a.plan.drop);
}

/** How dangerous he is in this draft: his win rate against teams with as many of his answers as yours has now. */
export const dangerOf = (t: DraftThreat): number => t.plan.stair[t.step].winRate;

/**
 * His lane with each of your laners who face his position in it (STRATZ laneOutcome: the result is the whole
 * lane's), from your rank group when it has the pair, else every rank. Allies without a position are left out.
 */
export function threatLanes(engine: Engine, hero: number, position: Position, allies: AllyPick[], bracket?: RankBracket): ThreatLane[] {
  const outcomes = engine.data.laneOutcomes;
  if (!outcomes) return [];
  const group = bracket ? String(rankGroup(bracket)) : undefined;
  const lanes: ThreatLane[] = [];
  for (const ally of allies) {
    if (!ally.position || !LANE_OPPONENTS[ally.position].includes(position)) continue;
    const slice = group && outcomes[group]?.[hero]?.[ally.heroId] ? group : "0";
    const pair = outcomes[slice]?.[hero]?.[ally.heroId];
    if (!pair || pair[0] <= 0) continue;
    const usual: LaneCounts = [0, 0, 0, 0];
    for (const c of Object.values(outcomes[slice]?.[hero] ?? {})) c.forEach((n, i) => (usual[i] = usual[i]! + n));
    lanes.push({ ally: ally.heroId, with: pair, usual });
  }
  return lanes;
}

/** When he finishes his big item at your rank (the slice his item build uses), or undefined without enough games. */
export function threatPace(engine: Engine, hero: number, position: Position, bracket?: RankBracket): ThreatPace | undefined {
  const slice = chooseTimingSlice(engine.data, hero, position, bracket)?.slice;
  const pace = slice?.pace;
  if (!slice || !pace) return undefined;
  const listed = slice.items.find(([id]) => id === pace.itemId)?.[1];
  const games = pace.minutes.reduce((n, [, g]) => n + g, 0);
  const minute = listed ?? Math.round(pace.minutes.reduce((n, [m, g]) => n + m * g, 0) / games);
  const sum = (keep: (m: number) => boolean): StairStep => {
    const rows = pace.minutes.filter(([m]) => keep(m));
    const n = rows.reduce((s, [, g]) => s + g, 0);
    const w = rows.reduce((s, [, , x]) => s + x, 0);
    return { games: n, winRate: n ? Math.round((1000 * w) / n) / 10 : 0 };
  };
  const early = sum((m) => m <= minute - PACE_EARLY);
  const late = sum((m) => m > minute && m <= minute + PACE_LATE);
  if (early.games < MIN_PACE_GAMES || late.games < MIN_PACE_GAMES) return undefined;
  return { itemId: pace.itemId, minute, early, late, minutes: pace.minutes };
}
