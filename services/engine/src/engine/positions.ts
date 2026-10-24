import { POSITIONS, type HeroInfo, type Position, type Snapshot } from "./types";

export type PositionFit = Record<Position, number>;

/** Below this many games, STRATZ position counts are too thin to use on their own. */
const MIN_POSITION_GAMES = 200;

/**
 * How likely a hero is to be played in each position, summing to 1.
 *
 * STRATZ position counts are used when there are enough of them. Otherwise
 * OpenDota tells us which lane a hero goes to, but not whether it is the core
 * or the support in that lane, so the safe lane is split between pos 1 and 5
 * and the offlane between pos 3 and 4 using the hero's Support/Carry roles.
 */
export function positionFit(
  hero: HeroInfo,
  lanes: Snapshot["laneRoles"][string] | undefined,
  positions?: number[],
): PositionFit {
  if (positions && positions.reduce((s, g) => s + g, 0) >= MIN_POSITION_GAMES) {
    const [p1 = 0, p2 = 0, p3 = 0, p4 = 0, p5 = 0] = positions;
    return normalize({ 1: p1, 2: p2, 3: p3, 4: p4, 5: p5 });
  }
  const isSupport = hero.roles.includes("Support");
  const isCarry = hero.roles.includes("Carry");
  const supportShare = isSupport ? (isCarry ? 0.5 : 0.85) : 0.1;

  const safe = lanes?.["1"] ?? 0;
  const mid = lanes?.["2"] ?? 0;
  const off = lanes?.["3"] ?? 0;
  const jungle = lanes?.["4"] ?? 0;
  const total = safe + mid + off + jungle;

  let fit: PositionFit;
  if (total > 0) {
    fit = {
      1: safe * (1 - supportShare),
      2: mid,
      3: off * (1 - supportShare),
      4: off * supportShare + jungle,
      5: safe * supportShare,
    };
  } else {
    // No lane data yet: fall back to roles alone.
    const core = isCarry || !isSupport ? 1 : 0.2;
    const sup = isSupport ? 1 : 0.1;
    fit = { 1: core, 2: core * 0.8, 3: core * (hero.roles.includes("Durable") ? 1 : 0.6), 4: sup, 5: sup };
  }
  return normalize(fit);
}

function normalize(fit: PositionFit): PositionFit {
  const sum = POSITIONS.reduce((s, p) => s + fit[p], 0) || 1;
  return { 1: fit[1] / sum, 2: fit[2] / sum, 3: fit[3] / sum, 4: fit[4] / sum, 5: fit[5] / sum };
}

/**
 * Guess where each enemy is playing. Every enemy takes a different position,
 * so we weigh every possible assignment by how natural it is for each hero
 * and return, per enemy, the probability of each position.
 */
export function guessEnemyPositions(enemyFits: PositionFit[]): PositionFit[] {
  const n = enemyFits.length;
  const marginals = enemyFits.map(() => ({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }) as PositionFit);
  let total = 0;

  const assigned: Position[] = [];
  const used = new Set<Position>();
  const walk = (i: number, weight: number) => {
    if (weight === 0) return;
    if (i === n) {
      total += weight;
      assigned.forEach((pos, e) => (marginals[e]![pos] += weight));
      return;
    }
    for (const pos of POSITIONS) {
      if (used.has(pos)) continue;
      used.add(pos);
      assigned.push(pos);
      walk(i + 1, weight * Math.max(enemyFits[i]![pos], 1e-4));
      assigned.pop();
      used.delete(pos);
    }
  };
  walk(0, 1);

  return total > 0 ? marginals.map((m) => normalize(m)) : enemyFits;
}

/** Enemy positions you mostly face in lane when playing each position. */
export const LANE_OPPONENTS: Record<Position, Position[]> = {
  1: [3, 4],
  2: [2],
  3: [1, 5],
  4: [1, 5],
  5: [3, 4],
};
