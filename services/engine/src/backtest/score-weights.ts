/**
 * Learns how much each score part (counter, synergy, meta, ...) should count, from saved ranked
 * games instead of hand-set weights. Every pick with a known position is one sample: the score
 * parts of the hero the player took, as the engine saw the draft at that moment, and whether
 * that player won. A logistic fit says how strongly each part predicts a win.
 *
 * Every part is already in win-rate points, so with the hand-set weights a part worth +1 should
 * add about 1% to the win chance, a logistic slope of PRIOR_SLOPE. The fit is pulled toward that
 * slope (a ridge penalty), so a part only moves away from its hand weight when the games say so.
 * A multiplier is the fitted slope over PRIOR_SLOPE, kept between 0 and MAX_WEIGHT.
 *
 * The learned weights are kept only when, on newer games they were not fitted on, the engine
 * with them beats both the hand-set engine and the "highest win rate" rival on win lift.
 */
import type { EvalMatch } from "../data/eval-matches";
import { Engine, HAND_WEIGHTS } from "../engine/score";
import type { ScoreBreakdown, ScoreWeights, Snapshot } from "../engine/types";
import { backtest, draftAt, engineSuggester, metaSuggester, type BacktestResult } from "./backtest";

export const PARTS = Object.keys(HAND_WEIGHTS) as (keyof ScoreBreakdown)[];

/** Logistic slope of one win-rate point near 50%: d logit / d p = 4, times 0.01. */
export const PRIOR_SLOPE = 0.04;
/** A part may count at most this many times its hand weight. */
export const MAX_WEIGHT = 3;
/**
 * Pull toward the hand weights: the penalty is RIDGE * (multiplier - 1)^2 / 2 in log likelihood.
 * One pick whose counter part is 3 points carries about 0.25 * (3 * PRIOR_SLOPE)^2 = 0.0036 of
 * this, so 20,000 picks (about 2,000 games) weigh about 72 against 50 here.
 */
export const RIDGE = 50;
/** Saved games needed before the weights are fitted at all (the same bar as pick phase). */
export const MIN_GAMES = 3000;
/** Share of the newest games kept out of the fit to check it. */
export const CHECK_SHARE = 0.25;
/** The learned weights must beat the hand weights' win lift by at least this many points. */
export const MIN_LIFT_GAIN = 0.5;

export interface PickSample {
  parts: number[];
  won: boolean;
}

/** One sample per pick with a known position, scored with the hand-set weights. */
export function pickSamples(engine: Engine, games: EvalMatch[]): PickSample[] {
  const samples: PickSample[] = [];
  for (const game of games) {
    game.picks.forEach((pick, i) => {
      const input = draftAt(game, i, Number.MAX_SAFE_INTEGER);
      if (!input) return;
      const taken = engine.suggest(input).find((s) => s.heroId === pick.heroId);
      if (!taken) return;
      samples.push({ parts: PARTS.map((k) => taken.breakdown[k]), won: pick.radiant === game.radiantWin });
    });
  }
  return samples;
}

/**
 * Logistic regression with an intercept and one slope per part, by Newton's method. Each slope is
 * pulled toward PRIOR_SLOPE with a ridge penalty of `ridge` (in multiplier units).
 */
export function fitWeights(samples: PickSample[], ridge = RIDGE): ScoreWeights {
  const k = PARTS.length;
  const n = k + 1;
  const beta = [0, ...PARTS.map(() => PRIOR_SLOPE)];
  // A penalty of ridge * (m - 1)^2 with m = slope / PRIOR_SLOPE, in slope units.
  const lambda = ridge / (PRIOR_SLOPE * PRIOR_SLOPE);
  for (let iter = 0; iter < 50; iter++) {
    const grad = new Array<number>(n).fill(0);
    const hess = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    for (let j = 1; j < n; j++) {
      grad[j]! -= lambda * (beta[j]! - PRIOR_SLOPE);
      hess[j]![j]! -= lambda;
    }
    for (const s of samples) {
      const x = [1, ...s.parts];
      const z = x.reduce((t, v, j) => t + v * beta[j]!, 0);
      const p = 1 / (1 + Math.exp(-z));
      const w = p * (1 - p);
      const r = (s.won ? 1 : 0) - p;
      for (let a = 0; a < n; a++) {
        grad[a]! += r * x[a]!;
        for (let b = 0; b < n; b++) hess[a]![b]! -= w * x[a]! * x[b]!;
      }
    }
    const step = solve(hess, grad);
    if (!step) break;
    let moved = 0;
    for (let j = 0; j < n; j++) {
      beta[j]! -= step[j]!;
      moved = Math.max(moved, Math.abs(step[j]!));
    }
    if (moved < 1e-10) break;
  }
  const weights = { ...HAND_WEIGHTS };
  PARTS.forEach((part, i) => {
    weights[part] = round(Math.min(MAX_WEIGHT, Math.max(0, beta[i + 1]! / PRIOR_SLOPE)));
  });
  return weights;
}

export interface WeightCheck {
  keep: boolean;
  /** Why the learned weights are or are not used, for the job summary. */
  verdict: string;
  fitGames: number;
  checkGames: number;
  picks: number;
  weights: ScoreWeights | null;
  results: BacktestResult[];
}

/** Win lift in points, or null when a group had no picks. */
export function liftOf(r: BacktestResult): number | null {
  return r.top3.winRate === null || r.other.winRate === null ? null : (r.top3.winRate - r.other.winRate) * 100;
}

/**
 * Fits on the older games and checks on the newer ones. `games` must be sorted oldest first.
 * The snapshot's own learned weights are ignored, so each refresh fits from the hand weights.
 */
export function fitAndCheck(snapshot: Snapshot, games: EvalMatch[]): WeightCheck {
  const split = Math.floor(games.length * (1 - CHECK_SHARE));
  const base = { fitGames: split, checkGames: games.length - split, picks: 0, weights: null, results: [] };
  if (games.length < MIN_GAMES) {
    return { ...base, keep: false, verdict: `Only ${games.length} of ${MIN_GAMES} saved games, the hand-set weights stay.` };
  }
  const hand = new Engine(snapshot, { scoreWeights: null });
  const samples = pickSamples(hand, games.slice(0, split));
  const weights = fitWeights(samples);
  const learned = new Engine(snapshot, { scoreWeights: weights });
  const check = games.slice(split);
  const results = [
    backtest("Learned weights", engineSuggester(learned), check),
    backtest("Hand-set weights", engineSuggester(hand), check),
    backtest("Highest win rate", metaSuggester(hand), check),
  ];
  const [l, h, m] = results.map(liftOf);
  const keep = l != null && h != null && m != null && l >= h + MIN_LIFT_GAIN && l > m;
  const verdict = keep
    ? `The learned weights win (lift ${fmt(l)} against ${fmt(h)} hand-set and ${fmt(m)} highest win rate) and are used.`
    : `The learned weights don't beat the hand-set ones by ${MIN_LIFT_GAIN} points and the highest win rate (lift ${fmt(l)}, ${fmt(h)}, ${fmt(m)}), the hand-set weights stay.`;
  return { ...base, keep, verdict, picks: samples.length, weights, results };
}

/** The check as markdown for the job summary. */
export function weightsToMarkdown(check: WeightCheck): string {
  const lines = [`Score weights: fitted on ${check.fitGames} games, checked on ${check.checkGames} newer ones. ${check.verdict}`];
  if (check.weights) {
    lines.push("", "| Part | Learned weight |", "| --- | --- |", ...PARTS.map((p) => `| ${p} | ${check.weights![p].toFixed(2)} |`));
  }
  if (check.results.length) {
    lines.push("", "| Suggester | Win rate, took a top 3 (picks) | Win lift |", "| --- | --- | --- |");
    for (const r of check.results) {
      const rate = r.top3.winRate === null ? "n/a" : `${(r.top3.winRate * 100).toFixed(1)}%`;
      lines.push(`| ${r.name} | ${rate} (${r.top3.picks}) | ${fmt(liftOf(r))} |`);
    }
  }
  return lines.join("\n");
}

const fmt = (x: number | null | undefined) => (x == null ? "n/a" : `${x >= 0 ? "+" : ""}${x.toFixed(1)} pts`);
const round = (x: number) => Math.round(x * 100) / 100;

/** Solves a x = b by Gaussian elimination with partial pivoting; null when singular. */
function solve(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m: number[][] = a.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[pivot]![c]!)) pivot = r;
    if (Math.abs(m[pivot]![c]!) < 1e-12) return null;
    [m[c], m[pivot]] = [m[pivot]!, m[c]!];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r]![c]! / m[c]![c]!;
      for (let k = c; k <= n; k++) m[r]![k]! -= f * m[c]![k]!;
    }
  }
  return m.map((row, i) => row[n]! / row[i]!);
}
