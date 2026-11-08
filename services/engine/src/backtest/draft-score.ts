/**
 * How well the engine's view of a finished draft predicts the winner. For every game with all ten
 * picks, draftEdge says which side's heroes, matchups and synergy are better; the favored side
 * should win more than half the time. This needs no fitted win model, so it works on any hero
 * data, and it is the number to watch when changing how matchups, synergy or win rates are
 * worked out. When the hero data has a checked win model, its log loss is scored too: below a
 * coin flip's (ln 2 = 0.6931) means the chances it shows are better than nothing.
 */
import type { EvalMatch } from "../data/eval-matches";
import type { Engine } from "../engine/score";
import { draftEdge, winChance } from "../engine/win-chance";
import { bracketOf } from "./backtest";

/** Sums, so groups scored with different hero data add up. */
export interface DraftScore {
  /** Games with all ten picks and a side favored. */
  games: number;
  /** Of those, games the favored side won. */
  correct: number;
  /** Games with a win model, and the sums of (log loss - ln 2) and its square, for the margin. */
  modelGames: number;
  lossGain: number;
  lossGainSq: number;
}

export const emptyDraftScore = (): DraftScore => ({ games: 0, correct: 0, modelGames: 0, lossGain: 0, lossGainSq: 0 });

export function addDraftScores(a: DraftScore, b: DraftScore): DraftScore {
  return {
    games: a.games + b.games,
    correct: a.correct + b.correct,
    modelGames: a.modelGames + b.modelGames,
    lossGain: a.lossGain + b.lossGain,
    lossGainSq: a.lossGainSq + b.lossGainSq,
  };
}

export function scoreDrafts(engine: Engine, games: EvalMatch[]): DraftScore {
  const score = emptyDraftScore();
  for (const game of games) {
    if (game.picks.length !== 10) continue;
    const radiant = game.picks.filter((p) => p.radiant).map((p) => p.heroId);
    const dire = game.picks.filter((p) => !p.radiant).map((p) => p.heroId);
    const edge = draftEdge(engine, radiant, dire, bracketOf(game.rankTier));
    if (edge === 0) continue;
    score.games++;
    if (edge > 0 === game.radiantWin) score.correct++;
    const p = winChance(engine.data.winModel, edge, 10);
    if (p === null) continue;
    // Kept off 0 and 1 so one confident miss can't make the sum infinite.
    const q = Math.min(Math.max(game.radiantWin ? p : 1 - p, 1e-6), 1 - 1e-6);
    const gain = -Math.log(q) - Math.LN2;
    score.modelGames++;
    score.lossGain += gain;
    score.lossGainSq += gain * gain;
  }
  return score;
}

/** One line for the summary, each number with its 95% margin. */
export function draftScoreLine(s: DraftScore): string {
  if (!s.games) return "Draft winner: no games with all ten picks.";
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const acc = s.correct / s.games;
  const accMargin = 1.96 * Math.sqrt((acc * (1 - acc)) / s.games);
  let line = `Draft winner on ${s.games} games: the side the engine favors won ${pct(acc)} ± ${pct(accMargin)} (50% is a coin flip).`;
  if (s.modelGames) {
    const mean = s.lossGain / s.modelGames;
    const sd = Math.sqrt(Math.max(0, s.lossGainSq / s.modelGames - mean * mean));
    const margin = (1.96 * sd) / Math.sqrt(s.modelGames);
    line += ` Win model log loss ${(Math.LN2 + mean).toFixed(4)} ± ${margin.toFixed(4)} on ${s.modelGames} games (a coin flip is 0.6931, lower is better).`;
  }
  return line;
}
