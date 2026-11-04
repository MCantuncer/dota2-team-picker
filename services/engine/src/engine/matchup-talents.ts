/**
 * The talent tree for this game: for each tier, whether players who took the other talent did
 * better against these enemies than players who took the usual one (skill order plan, "Change 2
 * FINAL" and its amendments).
 *
 * The games come from the live matchup lookup: our hero's high-rank wins against each enemy and
 * the enemies' wins against our hero (our hero's losses). Wins and losses were picked separately,
 * about half and half, so a win rate inside them means nothing. Only the comparison of the two
 * talents is valid, as an odds ratio: OR = (wins/losses with Y) / (wins/losses with X).
 *
 * Few games give noisy ratios, so the estimate starts from STRATZ's overall odds ratio of the two
 * talents (all games at this rank) and moves toward the matchup games as they add up (a normal
 * prior on log OR, width PRIOR_SD). The card shows the odds and the games behind them, never raw wins and losses.
 */
import type { SkillBuildSlice } from "./types";

/** One game of our hero from the live lookup. */
export interface MatchupGame {
  match: number;
  account: number;
  won: boolean;
  level: number;
  version: number;
  /** Skill points in order: ability, talent or attribute bonus ids. */
  points: number[];
  /** Purchases in order, [item id, seconds]; missing on rows cached before 2026-11-04 (see item-odds.ts). */
  items?: [number, number][];
  /** Game length in seconds. */
  duration?: number;
  /** Networth lead of our hero's team per minute, negative when behind; empty when STRATZ has none. */
  lead?: number[];
}

/** How sure the comparison is that the other talent is better against these enemies. */
export type TalentResult = "recommended" | "leaning" | "no-clear-difference" | "too-few-games";

export interface TierChoice {
  tier: number;
  /** The talent most players take in general (the weekly build). */
  usual: number;
  /** The talent to show as this game's pick: the other one only when "recommended". */
  pick: number;
  result: TalentResult;
  /** Raw wins and losses in the matchup games for each side, usual first. */
  sides: { id: number; wins: number; losses: number }[];
  /** The adjusted odds ratio of the other talent against the usual one. */
  oddsRatio: number;
  /** The chance the other talent's odds ratio is above BETTER_RATIO. */
  chance: number;
}

/** Width of the prior on log OR until the cache has enough matchups to fit it. */
export const PRIOR_SD = 0.7;
/** "Better" means at least this odds ratio. */
export const BETTER_RATIO = 1.5;
/** The chance needed to recommend the other talent, and to lean to it. */
export const RECOMMEND_CHANCE = 0.95;
export const LEAN_CHANCE = 0.75;
/** Fewer matchup games than this in a tier and it says "too few games" and keeps the usual talent (plan, Change 2 item 5). */
export const MIN_TIER_GAMES = 10;

/** Standard normal CDF (Abramowitz and Stegun 7.1.26, error under 1.5e-7). */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/** At most this many wins, and this many losses, of one Steam account in a draft's sample. */
const GAMES_PER_ACCOUNT = 2;

/**
 * The games against all the enemies as one sample: each match once (a game against two of the
 * enemies came back for both), and at most GAMES_PER_ACCOUNT wins and as many losses per Steam
 * account. The cap is per result so wins and losses are picked the same way whatever the order.
 */
export function poolGames(games: MatchupGame[]): MatchupGame[] {
  const seen = new Set<number>();
  const perAccount = new Map<string, number>();
  return games.filter((g) => {
    const who = `${g.account}:${g.won}`;
    const n = perAccount.get(who) ?? 0;
    if (seen.has(g.match) || n >= GAMES_PER_ACCOUNT) return false;
    seen.add(g.match);
    perAccount.set(who, n + 1);
    return true;
  });
}

/**
 * The talent a game took in this tier: the first of the pair in its points. Past level 25 players
 * learn the skipped talents too, so a long game has both; only the first was the choice. STRATZ
 * sends some points as 0 (a talent it couldn't name); one before the pair may have been the real
 * choice, so the game doesn't count in this tier.
 */
export function tookFirst(points: number[], pair: Set<number>): number | undefined {
  const at = points.findIndex((id) => pair.has(id));
  if (at < 0 || points.slice(0, at).includes(0)) return undefined;
  return points[at];
}

const logOdds = (wins: number, losses: number) => Math.log((wins + 0.5) / (losses + 0.5));

/** STRATZ's overall log OR of `other` against `usual`, or 0 when the totals have no wins. */
function priorMean(sides: { id: number; games: number; wins: number }[] | undefined, usual: number, other: number) {
  const x = sides?.find((s) => s.id === usual);
  const y = sides?.find((s) => s.id === other);
  if (!x || !y || x.games <= x.wins || y.games <= y.wins || x.wins <= 0 || y.wins <= 0) return 0;
  return logOdds(y.wins, y.games - y.wins) - logOdds(x.wins, x.games - x.wins);
}

/**
 * Each tier's choice for this game. `pairs` are the hero's talents by tier, `general` the weekly
 * slice's talents (the usual pick and STRATZ's totals). A tier counts only games that reached it.
 */
export function chooseMatchupTalents(
  pairs: { id: number }[][],
  general: SkillBuildSlice["talents"],
  games: MatchupGame[],
): TierChoice[] {
  const pooled = poolGames(games);
  return general.flatMap((g) => {
    const pair = pairs[g.tier];
    const other = pair?.find((t) => t.id !== g.id)?.id;
    if (!pair || pair.length !== 2 || other === undefined) return [];
    const ids = new Set([g.id, other]);
    // A game counts in this tier only when it took one of the pair, so games that ended earlier don't.
    const took = pooled.map((m) => ({ won: m.won, id: tookFirst(m.points, ids) }));
    const count = (id: number, won: boolean) => took.filter((t) => t.won === won && t.id === id).length;
    const x = { id: g.id, wins: count(g.id, true), losses: count(g.id, false) };
    const y = { id: other, wins: count(other, true), losses: count(other, false) };
    const sides = [x, y];
    const observed = logOdds(y.wins, y.losses) - logOdds(x.wins, x.losses);
    const variance = [x.wins, x.losses, y.wins, y.losses].reduce((v, c) => v + 1 / (c + 0.5), 0);
    const priorPrecision = 1 / PRIOR_SD ** 2;
    const precision = priorPrecision + 1 / variance;
    const mean = (priorPrecision * priorMean(g.sides, g.id, other) + observed / variance) / precision;
    const chance = 1 - normalCdf((Math.log(BETTER_RATIO) - mean) / Math.sqrt(1 / precision));
    const total = x.wins + x.losses + y.wins + y.losses;
    const result: TalentResult =
      total < MIN_TIER_GAMES
        ? "too-few-games"
        : chance >= RECOMMEND_CHANCE
          ? "recommended"
          : chance >= LEAN_CHANCE
            ? "leaning"
            : "no-clear-difference";
    return [
      {
        tier: g.tier,
        usual: g.id,
        pick: result === "recommended" ? other : g.id,
        result,
        sides,
        oddsRatio: Math.round(Math.exp(mean) * 10) / 10,
        chance: Math.round(chance * 100) / 100,
      },
    ];
  });
}

/**
 * The card's line for a tier: one sentence on what to take and why, with no raw wins and losses (Can
 * 2026-11-02) and no win rate, since the sample was picked half wins and half losses. The odds go in
 * `oddsLabel`, small under it. `name` gives a talent's name, `enemies` the enemy heroes' names, and
 * `usual` how often the usual talent was taken in the weekly slice's games that reached this tier.
 */
export function tierReason(
  c: TierChoice,
  name: (id: number) => string,
  enemies: string[],
  usual: { share: number; games: number },
): string {
  const [x, y] = c.sides;
  if (!x || !y) return "";
  const against = `against ${listOr(enemies)}`;
  // The usual talent is the one taken more often, so a tie can't say "most players".
  const who = usual.share > 0.5 ? "most players take" : "players take as often as the other";
  const most = `${name(x.id)}, which ${who} (${Math.round(usual.share * 100)}% of ${usual.games} recent games)`;
  switch (c.result) {
    case "too-few-games":
      return `Too few high-rank games ${against} to compare, so take ${most}.`;
    case "recommended":
      return `Take ${name(y.id)} ${against}: it did better than ${most}.`;
    case "leaning":
      return `${name(y.id)} did better ${against}, but not surely enough to switch from ${most}.`;
    case "no-clear-difference":
      return `No clear difference ${against}, so take ${most}.`;
  }
}

/**
 * The small line under a reason: "1.8x the odds · 42 games" (Can chose this form, 2026-11-03), the other
 * talent against the usual one, over the matchup games that reached this tier. Only when the comparison
 * leans to the other talent; otherwise there is no number worth showing.
 */
export function oddsLabel(c: TierChoice): string | undefined {
  if (c.result !== "recommended" && c.result !== "leaning") return undefined;
  const games = c.sides.reduce((n, s) => n + s.wins + s.losses, 0);
  return `${c.oddsRatio}x the odds · ${games} games`;
}

/** Shown once per card under the talent tree, so the odds are read as a comparison, not a win rate. */
export const SAMPLE_NOTE =
  "Odds compare the two talents in high-rank games against these heroes, adjusted toward all games when there are few.";

function listOr(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "these heroes";
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}
