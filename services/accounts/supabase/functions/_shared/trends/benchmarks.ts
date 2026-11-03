/**
 * Strong game checks: STRATZ IMP when we have it, otherwise the player's per minute stats
 * against the hero's OpenDota benchmarks (GET /benchmarks?hero_id=). Benchmarks mix every
 * rank and position, which is why the card's text always says "on OpenDota (all ranks)".
 */
import type { Position } from "./games.ts";

export type BenchmarkStat =
  | "gold_per_min"
  | "xp_per_min"
  | "last_hits_per_min"
  | "hero_damage_per_min"
  | "kills_per_min"
  | "hero_healing_per_min";

const BENCHMARK_STATS: readonly BenchmarkStat[] = [
  "gold_per_min",
  "xp_per_min",
  "last_hits_per_min",
  "hero_damage_per_min",
  "kills_per_min",
  "hero_healing_per_min",
];

export interface BenchmarkPoint {
  /** 0 to 1. */
  percentile: number;
  value: number;
}

/** A hero's benchmark points per stat, sorted by percentile. */
export type HeroBenchmarks = Partial<Record<BenchmarkStat, BenchmarkPoint[]>>;

/** STRATZ IMP from which a game counts as strong. 0 is an average game. */
export const STRONG_IMP = 20;
/** Cores are judged on farm, which a win lifts, so they need a higher bar than supports. */
export const CORE_STRONG_PERCENTILE = 0.65;
export const SUPPORT_STRONG_PERCENTILE = 0.6;
const CORE_STATS: readonly BenchmarkStat[] = ["gold_per_min", "xp_per_min", "last_hits_per_min", "hero_damage_per_min"];
/** Supports get stats less tied to farm; healing only for heroes that heal. */
const SUPPORT_STATS: readonly BenchmarkStat[] = ["hero_damage_per_min", "kills_per_min", "hero_healing_per_min"];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Reads a /benchmarks response. Stats with no usable points are left out. */
export function readHeroBenchmarks(raw: unknown): HeroBenchmarks {
  const result = isObj(raw) && isObj(raw.result) ? raw.result : {};
  const out: HeroBenchmarks = {};
  for (const stat of BENCHMARK_STATS) {
    const rows = result[stat];
    if (!Array.isArray(rows)) continue;
    const points = rows
      .filter((r): r is Obj => isObj(r) && isNum(r.percentile) && isNum(r.value))
      .map((r) => ({ percentile: r.percentile as number, value: r.value as number }))
      .filter((p) => p.percentile > 0 && p.percentile < 1)
      .sort((a, b) => a.percentile - b.percentile);
    if (points.length > 0) out[stat] = points;
  }
  return out;
}

/**
 * Where a value falls in the benchmark points (0 to 1), interpolating between points. Below
 * the lowest point it scales down towards 0; above the highest it stays at the highest.
 */
export function percentileOf(points: BenchmarkPoint[], value: number): number {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return 0;
  if (value <= first.value) return first.value > 0 ? Math.max(0, (value / first.value) * first.percentile) : 0;
  if (value >= last.value) return last.percentile;
  for (let i = 1; i < points.length; i++) {
    const lo = points[i - 1];
    const hi = points[i];
    if (!lo || !hi || value > hi.value) continue;
    const span = hi.value - lo.value;
    return span > 0 ? lo.percentile + ((value - lo.value) / span) * (hi.percentile - lo.percentile) : hi.percentile;
  }
  return last.percentile;
}

/** The stats a position is judged on, for this hero. */
export function statsFor(position: Position, benchmarks: HeroBenchmarks): BenchmarkStat[] {
  if (position <= 3) return CORE_STATS.filter((s) => benchmarks[s]);
  return SUPPORT_STATS.filter((s) => {
    const points = benchmarks[s];
    if (!points) return false;
    // A hero whose median game heals nothing is not a healer.
    if (s === "hero_healing_per_min") return (points.find((p) => p.percentile >= 0.5)?.value ?? 0) > 0;
    return true;
  });
}

export interface BenchmarkVerdict {
  isStrong: boolean;
  percentiles: Partial<Record<BenchmarkStat, number>>;
}

/**
 * Judges one game against the hero's benchmarks: strong when the average percentile of the
 * position's stats reaches the bar. Null when the hero has no benchmarks for those stats.
 */
export function judgeByBenchmarks(
  position: Position,
  values: Partial<Record<BenchmarkStat, number>>,
  benchmarks: HeroBenchmarks,
): BenchmarkVerdict | null {
  const percentiles: Partial<Record<BenchmarkStat, number>> = {};
  for (const stat of statsFor(position, benchmarks)) {
    const points = benchmarks[stat];
    const value = values[stat];
    if (points && value !== undefined) percentiles[stat] = percentileOf(points, value);
  }
  const all = Object.values(percentiles);
  if (all.length === 0) return null;
  const average = all.reduce((sum, p) => sum + p, 0) / all.length;
  const bar = position <= 3 ? CORE_STRONG_PERCENTILE : SUPPORT_STRONG_PERCENTILE;
  return { isStrong: average >= bar, percentiles };
}

/** Judges one game by its STRATZ IMP. */
export const isStrongImp = (imp: number): boolean => imp >= STRONG_IMP;
