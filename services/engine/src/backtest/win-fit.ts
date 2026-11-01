/**
 * Fits and checks the draft win chance. For every saved game and each step of the draft (2, 4,
 * ... 10 heroes known), the draft edge of Radiant over Dire is one sample. A logistic curve per
 * step turns the edge into a chance, and a check on newer games makes sure a shown 60% really
 * wins about 60% of the time before the model is used.
 */
import type { EvalMatch } from "../data/eval-matches";
import type { Engine } from "../engine/score";
import { draftEdge, winChance, type WinModel } from "../engine/win-chance";
import { bracketOf } from "./backtest";

export const KNOWN_STEPS = [2, 4, 6, 8, 10];
/** A band's shown chance and real win rate may differ by this much (0.02 = 2 points). */
export const MAX_BAND_GAP = 0.02;
/** Bands with fewer games are too noisy to judge and are only reported. */
export const MIN_BAND_GAMES = 100;

export interface Sample {
  known: number;
  edge: number;
  won: boolean;
}

/** One sample per game and draft step, from Radiant's side. */
export function samplesOf(engine: Engine, games: EvalMatch[]): Sample[] {
  const samples: Sample[] = [];
  for (const game of games) {
    const bracket = bracketOf(game.rankTier);
    for (const known of KNOWN_STEPS) {
      const picks = game.picks.slice(0, known);
      const radiant = picks.filter((p) => p.radiant).map((p) => p.heroId);
      const dire = picks.filter((p) => !p.radiant).map((p) => p.heroId);
      samples.push({ known, edge: draftEdge(engine, radiant, dire, bracket), won: game.radiantWin });
    }
  }
  return samples;
}

/**
 * Logistic regression on one feature by Newton's method, with a small ridge penalty on the slope
 * so a handful of games cannot produce a wild curve.
 */
export function fitLogistic(samples: { edge: number; won: boolean }[], ridge = 1): { a: number; b: number } {
  let a = 0;
  let b = 0;
  for (let iter = 0; iter < 50; iter++) {
    let ga = 0;
    let gb = -ridge * b;
    let haa = 0;
    let hab = 0;
    let hbb = -ridge;
    for (const s of samples) {
      const p = 1 / (1 + Math.exp(-(a + b * s.edge)));
      const y = s.won ? 1 : 0;
      const w = p * (1 - p);
      ga += y - p;
      gb += (y - p) * s.edge;
      haa -= w;
      hab -= w * s.edge;
      hbb -= w * s.edge * s.edge;
    }
    const det = haa * hbb - hab * hab;
    if (Math.abs(det) < 1e-12) break;
    const da = (hbb * ga - hab * gb) / det;
    const db = (haa * gb - hab * ga) / det;
    a -= da;
    b -= db;
    if (Math.abs(da) < 1e-9 && Math.abs(db) < 1e-9) break;
  }
  return { a, b };
}

/** Fits one curve per draft step. */
export function fitWinModel(samples: Sample[], fittedAt: string, games: number): WinModel {
  const byKnown: WinModel["byKnown"] = {};
  for (const known of KNOWN_STEPS) {
    const step = samples.filter((s) => s.known === known);
    if (step.length) byKnown[known] = fitLogistic(step);
  }
  return { fittedAt, games, byKnown };
}

export interface Band {
  /** Shown chance of the favoured side, from this value up to 5 points more. */
  from: number;
  games: number;
  shown: number;
  won: number;
}

export interface WinCheck {
  passes: boolean;
  bands: Band[];
  logLoss: number;
  accuracy: number;
  games: number;
}

/**
 * Checks a model on games it was not fitted on. Each sample is seen from the favoured side and
 * put in a 5-point band (50-55%, 55-60%, ...). It passes when every band with enough games is
 * within 2 points of its real win rate and the chances beat a coin flip on log loss.
 */
export function checkWinModel(model: WinModel, samples: Sample[]): WinCheck {
  const bands = new Map<number, { games: number; shown: number; won: number }>();
  let loss = 0;
  let right = 0;
  let scored = 0;
  for (const s of samples) {
    const p = winChance(model, s.edge, s.known);
    if (p === null) continue;
    scored++;
    loss -= Math.log(Math.min(Math.max(s.won ? p : 1 - p, 1e-9), 1));
    const fav = Math.max(p, 1 - p);
    const favWon = p >= 0.5 ? s.won : !s.won;
    if (favWon) right++;
    const from = Math.min(Math.floor(fav * 20) / 20, 0.95);
    const band = bands.get(from) ?? { games: 0, shown: 0, won: 0 };
    band.games++;
    band.shown += fav;
    band.won += favWon ? 1 : 0;
    bands.set(from, band);
  }
  const list = [...bands.entries()]
    .sort(([a], [b]) => a - b)
    .map(([from, b]) => ({ from, games: b.games, shown: b.shown / b.games, won: b.won / b.games }));
  const judged = list.filter((b) => b.games >= MIN_BAND_GAMES);
  const logLoss = scored ? loss / scored : Infinity;
  const passes = judged.length > 0 && judged.every((b) => Math.abs(b.shown - b.won) <= MAX_BAND_GAP) && logLoss < Math.LN2;
  return { passes, bands: list, logLoss, accuracy: scored ? right / scored : 0, games: scored };
}

/** The check as a markdown table for the job summary. */
export function checkToMarkdown(check: WinCheck): string {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  return [
    `Win chance check on ${check.games} draft steps: ${check.passes ? "passed" : "not passed, the win chance stays hidden"}.`,
    `Log loss ${check.logLoss.toFixed(4)} (coin flip ${Math.LN2.toFixed(4)}), favourite won ${pct(check.accuracy)}.`,
    "",
    "| Shown chance | Draft steps | Average shown | Really won |",
    "| --- | --- | --- | --- |",
    ...check.bands.map(
      (b) =>
        `| ${Math.round(b.from * 100)} to ${Math.round(b.from * 100) + 5}% | ${b.games}${b.games < MIN_BAND_GAMES ? " (too few to judge)" : ""} | ${pct(b.shown)} | ${pct(b.won)} |`,
    ),
  ].join("\n");
}
