/**
 * How our hero's games against these enemies went in gold, compared with the same hero's games against other
 * enemies (richer Game Story proposal, step 1: measure first, nothing shows on the site yet).
 *
 * The live matchup lookup picks wins and losses separately, about half and half, so "wins led at 20" says
 * nothing: wins nearly always lead. The comparison is made inside each result instead: this lineup's wins
 * against the hero's other wins, and its losses against the other losses, then the two gaps are averaged.
 * A line like "against this lineup your team was 1.2k further behind at 10 than usual" can show only when the
 * gap is big enough to matter and at least two standard errors from zero.
 */
import type { MatchupGame } from "./matchup-talents";

/** Minutes the Story could talk about. */
export const LEAD_MINUTES = [10, 20] as const;
export type LeadMinute = (typeof LEAD_MINUTES)[number];

/** Smallest gap worth a line, in networth toward our hero's team: about a big item at 20, a small one at 10. */
export const MIN_GAP: Record<LeadMinute, number> = { 10: 500, 20: 1000 };
/** Games each result needs on the draft's side before its gap counts. */
export const MIN_RESULT_GAMES = 10;
/** Standard errors the gap must clear. */
export const MIN_Z = 2;

export interface LeadGap {
  minute: LeadMinute;
  /** This lineup's lead minus the usual lead, averaged over wins and losses; negative = further behind. */
  gap: number;
  se: number;
  /** Draft games with a lead at this minute. */
  games: number;
  shows: boolean;
}

/** Mean and variance of the leads at `minute`, or undefined when fewer than 2 games have one. */
function stats(games: MatchupGame[], minute: number) {
  const xs = games.flatMap((g) => {
    const v = g.lead?.[minute];
    return typeof v === "number" && Number.isFinite(v) ? [v] : [];
  });
  if (xs.length < 2) return undefined;
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  const variance = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (xs.length - 1);
  return { n: xs.length, mean, variance };
}

/**
 * The lead gap at `minute` of `draft` (our hero's pooled games against this lineup) against `others` (the same
 * hero and position against other enemies). Matches in both are dropped from `others`, so a game never meets itself.
 */
export function leadGap(draft: MatchupGame[], others: MatchupGame[], minute: LeadMinute): LeadGap {
  const inDraft = new Set(draft.map((g) => g.match));
  const base = others.filter((g) => !inDraft.has(g.match));
  let gap = 0;
  let varSum = 0;
  let games = 0;
  for (const won of [true, false]) {
    const d = stats(draft.filter((g) => g.won === won), minute);
    const b = stats(base.filter((g) => g.won === won), minute);
    if (!d || !b || d.n < MIN_RESULT_GAMES) return { minute, gap: 0, se: Infinity, games: d?.n ?? 0, shows: false };
    gap += (d.mean - b.mean) / 2;
    varSum += (d.variance / d.n + b.variance / b.n) / 4;
    games += d.n;
  }
  const se = Math.sqrt(varSum);
  const shows = Math.abs(gap) >= MIN_GAP[minute] && Math.abs(gap) >= MIN_Z * se;
  return { minute, gap, se, games, shows };
}

/**
 * A placebo draft: as many wins and losses as `draft` has, drawn without repeats from `others` (games not in the
 * draft), so its gap is only noise. Undefined when `others` is too small to draw from.
 */
export function placeboDraft(draft: MatchupGame[], others: MatchupGame[], random: () => number): MatchupGame[] | undefined {
  const inDraft = new Set(draft.map((g) => g.match));
  const out: MatchupGame[] = [];
  for (const won of [true, false]) {
    const need = draft.filter((g) => g.won === won).length;
    const pool = others.filter((g) => g.won === won && !inDraft.has(g.match));
    if (pool.length < need * 2) return undefined;
    for (let i = 0; i < need; i++) {
      const j = i + Math.floor(random() * (pool.length - i));
      // i and j are inside pool.
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
      out.push(pool[i]!);
    }
  }
  return out;
}
