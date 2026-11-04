/**
 * Item odds against these enemies (item journey plan, PR 9), from the live matchup lookup's games.
 *
 * The games were picked half wins and half losses, so a win rate inside them means nothing, and "had item X
 * by minute m" against "didn't" is reverse causation (an early item comes from already winning). So only
 * choices made at the same moment by games in the same state are compared:
 *
 * - Slot choice: games still running at minute m that bought their Nth big item in [m, m + 6): item A
 *   against item B, as an odds ratio.
 * - Fallback: games still running 6 minutes after the key item's late minute, without the key item by
 *   then: "kept going" (bought it in that window) against "switched" (bought another big item first).
 *
 * Each comparison is made inside networth lead buckets at minute m (a carry who is ahead buys greedy items)
 * and the buckets are combined by inverse variance, skipping a bucket with an empty cell.
 *
 * The bar is not the talents' bar on purpose: talents start from STRATZ's overall odds (a prior centred on
 * real data), items have no such overall number, so the prior is centred on 0 and the bar asks for more games.
 */
import { isCoreItem } from "./item-build";
import { type MatchupGame, normalCdf } from "./matchup-talents";
import type { ItemInfo } from "./types";

/** A game with the item fields (rows cached before 2026-11-04 have none). */
export type ItemGame = MatchupGame & Required<Pick<MatchupGame, "items" | "duration" | "lead">>;

export function hasItems(g: MatchupGame): g is ItemGame {
  return Array.isArray(g.items) && typeof g.duration === "number" && Array.isArray(g.lead);
}

/** The choice window after minute m, in minutes. */
export const WINDOW = 6;
/** Networth lead (toward our hero's team) past which a game is ahead or behind. */
export const EVEN_LEAD = 3000;
/**
 * Width of the prior on log OR, centred on 0: 95% of item effects between 0.37x and 2.7x the odds, which is
 * what item choices at the same moment plausibly do. It is set by that, not by how often lines show; a wider
 * prior shows more lines but prints odds about double the truth (scripts/item-odds-sim.ts).
 */
export const PRIOR_SD = 0.5;
/** The chance that the odds ratio is above 1 that a line needs to show. */
export const SHOW_CHANCE = 0.95;
/**
 * Each of the four cells (A won, A lost, B won, B lost) needs this many games, and the question this many,
 * counting only the lead buckets the estimate uses.
 */
export const MIN_CELL = 5;
export const MIN_GAMES = 30;

export type Bucket = "behind" | "even" | "ahead";

/** The game state at minute m, or undefined when the game has no lead for that minute. */
export function leadBucket(lead: number[], minute: number): Bucket | undefined {
  const v = lead[minute];
  if (v === undefined) return undefined;
  return v < -EVEN_LEAD ? "behind" : v > EVEN_LEAD ? "ahead" : "even";
}

/** Items a slot can be: core items (item-build.ts) except plain Boots of Speed, which every build passes through. */
export function isBigItem(item: ItemInfo | undefined): boolean {
  return isCoreItem(item) && item?.key !== "boots";
}

/** The game's big items, each once, at its first purchase: [item id, seconds]. */
export function bigItems(g: ItemGame, isBig: (id: number) => boolean): [number, number][] {
  const seen = new Set<number>();
  return g.items.filter(([id]) => {
    if (!isBig(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/** One side of a comparison in one bucket. */
interface Cell {
  wins: number;
  losses: number;
}
type Arms = { a: Cell; b: Cell };

/** Wins and losses of A and B per bucket; `arm` says which side a game is on, or undefined to leave it out. */
function tally(games: ItemGame[], minute: number, arm: (g: ItemGame) => "a" | "b" | undefined) {
  const buckets = new Map<Bucket, Arms>();
  for (const g of games) {
    const side = arm(g);
    const bucket = side && leadBucket(g.lead, minute);
    if (!side || !bucket) continue;
    const arms = buckets.get(bucket) ?? { a: { wins: 0, losses: 0 }, b: { wins: 0, losses: 0 } };
    arms[side][g.won ? "wins" : "losses"]++;
    buckets.set(bucket, arms);
  }
  return [...buckets.values()];
}

export interface ItemOdds {
  /** The odds ratio of B against A, pulled toward 1 by the prior (P(OR > 1) is one sided: B better only). */
  oddsRatio: number;
  /** The chance that B's odds ratio is above 1. */
  chance: number;
  /** Games in the buckets used, and the smallest of the four cells there. */
  games: number;
  minCell: number;
  /** Whether the line shows: enough games and a sure enough ratio. */
  shows: boolean;
}

/**
 * The buckets' log ORs combined by inverse variance, then pulled toward 0 by the prior. A bucket with an empty
 * cell has no finite log OR and is left out, games included; that can only pull the result toward 1.
 */
export function combine(all: Arms[]): ItemOdds {
  const buckets = all.filter(({ a, b }) => a.wins && a.losses && b.wins && b.losses);
  let weight = 0;
  let sum = 0;
  for (const { a, b } of buckets) {
    const variance = 1 / a.wins + 1 / a.losses + 1 / b.wins + 1 / b.losses;
    sum += Math.log((b.wins / b.losses) / (a.wins / a.losses)) / variance;
    weight += 1 / variance;
  }
  const precision = weight + 1 / PRIOR_SD ** 2;
  const mean = sum / precision;
  const chance = normalCdf(mean * Math.sqrt(precision));
  const total = (k: keyof Arms, r: keyof Cell) => buckets.reduce((n, x) => n + x[k][r], 0);
  const cells = [total("a", "wins"), total("a", "losses"), total("b", "wins"), total("b", "losses")];
  const games = cells.reduce((n, c) => n + c, 0);
  const minCell = Math.min(...cells);
  return {
    oddsRatio: Math.exp(mean),
    chance,
    games,
    minCell,
    shows: games >= MIN_GAMES && minCell >= MIN_CELL && chance >= SHOW_CHANCE,
  };
}

/** The Nth big item (from 1) a game bought, when it bought it in [minute, minute + WINDOW) and was still running. */
export function slotItem(g: ItemGame, slot: number, minute: number, isBig: (id: number) => boolean): number | undefined {
  if (g.duration <= minute * 60) return undefined;
  const nth = bigItems(g, isBig)[slot - 1];
  return nth && nth[1] >= minute * 60 && nth[1] < (minute + WINDOW) * 60 ? nth[0] : undefined;
}

/** Item B against item A as the Nth big item, bought in the window from `minute`. */
export function slotOdds(
  games: ItemGame[],
  q: { slot: number; minute: number; a: number; b: number },
  isBig: (id: number) => boolean,
): ItemOdds {
  return combine(
    tally(games, q.minute, (g) => {
      const id = slotItem(g, q.slot, q.minute, isBig);
      return id === q.a ? "a" : id === q.b ? "b" : undefined;
    }),
  );
}

/**
 * The fallback when the key item is late: the side a game is on, or undefined when it doesn't count.
 * Both sides ran past late + WINDOW and had no key item at `late`. "kept" bought it in [late, late + WINDOW),
 * "switched" bought another big item first in that window; a game with no big item there is left out.
 */
export function fallbackSide(
  g: ItemGame,
  key: number,
  late: number,
  isBig: (id: number) => boolean,
): "kept" | "switched" | undefined {
  if (g.duration <= (late + WINDOW) * 60) return undefined;
  const big = bigItems(g, isBig);
  if (big.some(([id, t]) => id === key && t < late * 60)) return undefined;
  const first = big.find(([, t]) => t >= late * 60 && t < (late + WINDOW) * 60);
  if (!first) return undefined;
  return first[0] === key ? "kept" : "switched";
}

/** "Switched" against "kept going" once the key item is late. */
export function fallbackOdds(games: ItemGame[], key: number, late: number, isBig: (id: number) => boolean): ItemOdds {
  return combine(
    tally(games, late, (g) => {
      const side = fallbackSide(g, key, late, isBig);
      return side === "kept" ? "a" : side === "switched" ? "b" : undefined;
    }),
  );
}

/** A small seeded random source (mulberry32), so the simulation and placebo runs repeat. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

/** One question for the placebo gate: its games, the minute its state is read at, and how to answer it. */
export interface PlaceboQuestion {
  games: ItemGame[];
  minute: number;
  ask: (games: ItemGame[]) => ItemOdds;
}

/**
 * The share of questions that pass in each shuffled run. Results are shuffled within each lead bucket at the
 * question's minute, so the link between state and result stays and only the item's own link is broken.
 */
export function placeboPassRates(questions: PlaceboQuestion[], runs: number, random: () => number): number[] {
  return Array.from({ length: runs }, () => {
    if (questions.length === 0) return 0;
    const passed = questions.filter((q) => {
      const won = q.games.map((g) => g.won);
      const groups = new Map<Bucket | undefined, number[]>();
      q.games.forEach((g, i) => {
        const b = leadBucket(g.lead, q.minute);
        groups.set(b, [...(groups.get(b) ?? []), i]);
      });
      for (const idx of groups.values()) {
        // Fisher-Yates over this bucket's game indexes; k and j stay inside idx, and its values inside won.
        for (let k = idx.length - 1; k > 0; k--) {
          const j = Math.floor(random() * (k + 1));
          const [x, y] = [idx[k]!, idx[j]!];
          [won[x], won[y]] = [won[y]!, won[x]!];
        }
      }
      // won has one entry per game.
      return q.ask(q.games.map((g, i) => ({ ...g, won: won[i]! }))).shows;
    });
    return passed.length / questions.length;
  });
}
