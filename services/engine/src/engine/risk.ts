/**
 * Blind pick risk: how much a hero stands to lose to the heroes the enemy is still likely to pick.
 *
 * For each enemy position not taken yet, every hero still in the pool gets a chance of being their
 * pick there (how often it is picked, times how often it plays that position). A hero's risk adds up
 * its losing matchups against them, weighted by those chances, with lane opponents counting extra.
 * Bans and picked heroes leave the pool, so banning a hero's counters lowers its risk.
 */
import { guessEnemyPositions, LANE_OPPONENTS, type PositionFit } from "./positions";
import { POSITIONS, type Position, type RankBracket } from "./types";

/** Extra weight on an enemy position you face in lane. */
const LANE_WEIGHT = 1.5;

/** The parts of the engine the risk needs. */
export interface RiskEngine {
  fit(id: number): PositionFit;
  pickRate(id: number): number;
  matchupEdge(a: number, b: number, bracket?: RankBracket): number;
}

export interface RiskInput {
  /** Heroes to judge. */
  candidates: number[];
  /** Heroes the enemy can still pick. */
  pool: number[];
  enemies: number[];
  myPosition: Position;
  rankBracket?: RankBracket;
  /** Pairs left out of the risk because another term already counts them, as `candidate-enemy`. */
  skip?: Set<string>;
}

/** Each open enemy position: how much of a pick is still to come there, and who may take it. */
export interface OpenSlot {
  position: Position;
  /** 0-1: the share of that position not yet covered by the enemies picked (sums to their picks left). */
  open: number;
  /** Chance each pool hero is their pick there, summing to 1. */
  chances: Map<number, number>;
}

export function openSlots(engine: RiskEngine, pool: number[], enemies: number[]): OpenSlot[] {
  if (enemies.length >= 5) return [];
  const guessed = guessEnemyPositions(enemies.map((e) => engine.fit(e)));
  return POSITIONS.flatMap((position) => {
    const open = Math.max(0, 1 - guessed.reduce((s, fit) => s + fit[position], 0));
    const weights = pool.map((id) => [id, engine.pickRate(id) * engine.fit(id)[position]] as const);
    const total = weights.reduce((s, [, w]) => s + w, 0);
    if (open < 0.01 || total <= 0) return [];
    return [{ position, open, chances: new Map(weights.map(([id, w]) => [id, w / total])) }];
  });
}

/** Chance (0-1) the enemy picks this hero in any of their open positions. */
export const pickChance = (slots: OpenSlot[], id: number) =>
  Math.min(1, slots.reduce((s, slot) => s + slot.open * (slot.chances.get(id) ?? 0), 0));

/**
 * Risk of each candidate, in win-rate points (0 or less), and how much each enemy hero adds to it.
 */
export function blindPickRisk(engine: RiskEngine, input: RiskInput): Map<number, { risk: number; by: Map<number, number> }> {
  const slots = openSlots(engine, input.pool, input.enemies);
  const lane = new Set(LANE_OPPONENTS[input.myPosition]);
  const out = new Map<number, { risk: number; by: Map<number, number> }>();
  for (const c of input.candidates) {
    const by = new Map<number, number>();
    for (const enemy of input.pool) {
      if (enemy === c || input.skip?.has(`${c}-${enemy}`)) continue;
      const edge = engine.matchupEdge(c, enemy, input.rankBracket);
      if (edge >= 0) continue;
      let weight = 0;
      for (const slot of slots) weight += slot.open * (lane.has(slot.position) ? LANE_WEIGHT : 1) * (slot.chances.get(enemy) ?? 0);
      if (weight > 0) by.set(enemy, weight * edge);
    }
    out.set(c, { risk: [...by.values()].reduce((s, x) => s + x, 0), by });
  }
  return out;
}
