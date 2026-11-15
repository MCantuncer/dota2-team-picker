/**
 * Fits and checks the draft win range. Each fair public game with all 10 heroes known gives
 * Radiant's draft edge and whether Radiant won. The games are cut into bands by edge, and each
 * band's real Radiant win rate, with its 95% range, is what the Draft page shows. A check on newer
 * games makes sure no band overstates a side before the ranges are used.
 */
import { bandOf, type WinRangeModel } from "../engine/win-range";

/** One game: Radiant's draft edge with 10 heroes known, and whether Radiant won. */
export interface EdgeSample {
  edge: number;
  won: boolean;
}

/** Where the band edges sit, as shares of the fitted games: narrow bands at the ends, wider ones in the middle. */
export const BAND_QUANTILES = [0.03, 0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 0.9, 0.97];
/** Fewer fitted games than this give ranges too wide to be useful; no model is made. */
export const MIN_FIT_GAMES = 20_000;
/** Check bands with fewer games are too noisy to judge and are only reported. */
export const MIN_CHECK_GAMES = 300;
/**
 * A band may be off by more than the noise only when the favourite of the band won more than shown,
 * and then by at most this much past the noise (0.05 = 5 points): a careful range is fine, a high one is not.
 */
export const MAX_CAREFUL_GAP = 0.05;
const Z95 = 1.96;

/** The value at share `q` (0-1) of sorted numbers. */
function quantile(sorted: number[], q: number): number {
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
}

const round = (x: number, digits: number) => Math.round(x * 10 ** digits) / 10 ** digits;

/** Half the width of the 95% range of a win rate from `games` games. */
export function margin(won: number, games: number): number {
  return games > 0 ? Z95 * Math.sqrt((won * (1 - won)) / games) : 1;
}

/** Bands by Radiant's edge, each with Radiant's real win rate and its 95% range. Null with too few games. */
export function fitWinRange(samples: EdgeSample[], fittedAt: string, days: WinRangeModel["days"]): WinRangeModel | null {
  if (samples.length < MIN_FIT_GAMES) return null;
  const sorted = samples.map((s) => s.edge).sort((a, b) => a - b);
  const cuts = [...new Set(BAND_QUANTILES.map((q) => round(quantile(sorted, q), 1)))];
  const counts = Array.from({ length: cuts.length + 1 }, () => ({ games: 0, wins: 0 }));
  for (const s of samples) {
    const band = counts[bandOf(cuts, s.edge)]!;
    band.games++;
    if (s.won) band.wins++;
  }
  const bands = counts.map(({ games, wins }) => {
    const won = games ? wins / games : 0.5;
    const m = margin(won, games);
    return { games, won: round(won, 4), low: round(Math.max(won - m, 0), 4), high: round(Math.min(won + m, 1), 4) };
  });
  return { fittedAt, games: samples.length, days, cuts, bands };
}

export interface RangeBandCheck {
  /** Edge from (null: open) up to (null: open). */
  from: number | null;
  to: number | null;
  /** Radiant's fitted win rate and range, and what it won on the newer games. */
  shown: { won: number; low: number; high: number };
  games: number;
  won: number;
  /** Judged (enough games) and whether it held. */
  judged: boolean;
  ok: boolean;
}

export interface WinRangeCheck {
  passes: boolean;
  games: number;
  bands: RangeBandCheck[];
}

/**
 * Checks fitted bands on newer games. A band holds when its newer win rate is inside the combined
 * noise of both, or when the band's favourite won more than shown (by at most MAX_CAREFUL_GAP past the noise). It
 * passes when every judged band holds and at least half the bands had enough games to judge.
 */
export function checkWinRange(model: WinRangeModel, samples: EdgeSample[]): WinRangeCheck {
  const counts = model.bands.map(() => ({ games: 0, wins: 0 }));
  for (const s of samples) {
    const band = counts[bandOf(model.cuts, s.edge)]!;
    band.games++;
    if (s.won) band.wins++;
  }
  const bands = model.bands.map((fitted, i) => {
    const { games, wins } = counts[i]!;
    const won = games ? wins / games : 0;
    const judged = games >= MIN_CHECK_GAMES;
    const gap = won - fitted.won;
    const noise = Math.hypot(margin(fitted.won, fitted.games), margin(won, games));
    // The favourite of a band is the side its fitted rate leans to; winning more than shown is careful.
    const careful = Math.sign(gap) === Math.sign(fitted.won - 0.5) && Math.abs(gap) <= noise + MAX_CAREFUL_GAP;
    return {
      from: i > 0 ? model.cuts[i - 1]! : null,
      to: i < model.cuts.length ? model.cuts[i]! : null,
      shown: { won: fitted.won, low: fitted.low, high: fitted.high },
      games,
      won,
      judged,
      ok: !judged || Math.abs(gap) <= noise || careful,
    };
  });
  const judged = bands.filter((b) => b.judged);
  const passes = judged.length * 2 >= bands.length && judged.every((b) => b.ok);
  return { passes, games: samples.length, bands };
}

/** The check as a markdown table for the job summary. */
export function rangeCheckToMarkdown(check: WinRangeCheck, fitted: number): string {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const edge = (b: RangeBandCheck) =>
    b.from === null ? `below ${b.to}` : b.to === null ? `${b.from} and up` : `${b.from} to ${b.to}`;
  return [
    `Win range check: fitted on ${fitted} public games, checked on ${check.games} newer ones: ` +
      `${check.passes ? "passed" : "not passed, the win range stays hidden"}.`,
    "",
    "| Radiant edge | Radiant won (range) | Newer games | Newer won | Held |",
    "| --- | --- | --- | --- | --- |",
    ...check.bands.map(
      (b) =>
        `| ${edge(b)} | ${pct(b.shown.won)} (${pct(b.shown.low)} to ${pct(b.shown.high)}) | ${b.games} | ${b.games ? pct(b.won) : "none"} | ` +
        `${b.judged ? (b.ok ? "yes" : "no") : "too few to judge"} |`,
    ),
  ].join("\n");
}
