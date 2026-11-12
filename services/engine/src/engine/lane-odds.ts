/**
 * Lane verdicts from real lane results (STRATZ laneOutcome, see data/stratz-lanes.ts): how often our laners
 * won, drew or lost the lane against the enemy heroes guessed to be in it. Whole-game matchups say who wins
 * the game, not the lane, so these counts replace them for the lane verdict when the snapshot has them.
 *
 * Each pair of our laner and their laner counts by how sure the enemy's position guess is. The lane's net is
 * the weighted share of lanes won minus lost; past NET_CLEAR the lane is a win or hard. The line names the
 * pair that decides it, with its numbers, so the reason can be checked.
 */
import { rankGroup, type LaneCounts, type Position, type RankBracket, type Snapshot } from "./types";

/** Net lane share (won minus lost) past which a lane counts as won or hard: 5 points, e.g. won 40%, lost 35%. */
export const NET_CLEAR = 0.05;

export interface PairLane {
  hero: number;
  enemy: number;
  games: number;
  won: number;
  drawn: number;
  lost: number;
  /** Set when the rank group had no lane data, so these counts are from every rank. */
  allRanks?: true;
}

export interface LaneOdds {
  /** Weighted won minus lost share of the lane's pairs, -1 to 1. */
  net: number;
  verdict: "win" | "even" | "hard";
  /** The pair that decides the verdict: the strongest one in its direction (or the closest for even). */
  key: PairLane;
}

/** Hero `a`'s lane against `b` at this rank, or for every rank when the rank group has too few games. */
export function pairLane(data: Snapshot, a: number, b: number, bracket?: RankBracket): PairLane | undefined {
  const at = (slice: string): LaneCounts | undefined => data.laneOutcomes?.[slice]?.[String(a)]?.[String(b)];
  const ranked = bracket ? at(String(rankGroup(bracket))) : undefined;
  const c = ranked ?? at("0");
  if (!c) return undefined;
  const [games, won, drawn, lost] = c;
  return games > 0 ? { hero: a, enemy: b, games, won, drawn, lost, ...(ranked ? {} : { allRanks: true as const }) } : undefined;
}

const netOf = (p: PairLane) => (p.won - p.lost) / p.games;

/**
 * The lane verdict for our heroes against their likely laners, each enemy weighted by the chance it is in the
 * lane (its odds at the lane's enemy positions). Undefined when no pair has lane data, so the caller keeps
 * its old verdict.
 */
export function laneOdds(
  data: Snapshot,
  ours: number[],
  theirs: { id: number; odds: Partial<Record<Position, number>> }[],
  lanePositions: Position[],
  bracket?: RankBracket,
): LaneOdds | undefined {
  const pairs: { pair: PairLane; weight: number }[] = [];
  for (const o of ours) {
    for (const t of theirs) {
      const weight = lanePositions.reduce((s, p) => s + (t.odds[p] ?? 0), 0);
      const pair = pairLane(data, o, t.id, bracket);
      if (pair && weight > 0) pairs.push({ pair, weight });
    }
  }
  const total = pairs.reduce((s, p) => s + p.weight, 0);
  if (!pairs.length || total <= 0) return undefined;
  const net = pairs.reduce((s, p) => s + p.weight * netOf(p.pair), 0) / total;
  const verdict = net >= NET_CLEAR ? "win" : net <= -NET_CLEAR ? "hard" : "even";
  // The pair that most supports the verdict, among the surer half of the guess; the closest pair when even.
  const sure = pairs.filter((p) => p.weight >= Math.max(...pairs.map((q) => q.weight)) / 2);
  const score = (p: PairLane) => (verdict === "win" ? netOf(p) : verdict === "hard" ? -netOf(p) : -Math.abs(netOf(p)));
  const key = sure.reduce((best, p) => (score(p.pair) > score(best.pair) ? p : best)).pair;
  return { net, verdict, key };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** "Juggernaut wins 44% and loses 31% of 8,120 lanes against Axe." */
export function pairText(p: PairLane, name: (id: number) => string): string {
  return `${name(p.hero)} wins ${pct(p.won / p.games)} and loses ${pct(p.lost / p.games)} of ${p.games.toLocaleString("en-US")} lanes against ${name(p.enemy)}.`;
}
