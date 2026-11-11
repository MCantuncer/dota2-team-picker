/**
 * Which items players buy more or less often lately (Can, 2026-11-11: Soul Ring on Slark), from two daily
 * copies of the snapshot a week or more apart. STRATZ's itemFullPurchase counts one week at a time (the daily
 * copies show every hero's counts restarting together each Thursday), so each copy's counts are already a
 * share of that week's games: two copies from different weeks are compared directly, never subtracted.
 * ItemTimingSlice.games is the slice's most bought item (Town Portal Scroll or boots, about every game), a
 * stand-in for its games used the same way in both copies.
 */
import type { ItemTimingSlice } from "./types";

/** The daily fetch keeps items bought in at least this share of the slice's games (ItemTimingSlice.shares). */
export const SHARE_MIN = 0.03;
/** Each copy needs this many games for a hero and position. */
export const MIN_GAMES = 1000;
/**
 * A change is flagged past this z score. A run makes about 7,000 item checks; at 4, about 0.4 pass by chance
 * (TREND_CHANCE each).
 */
export const TREND_Z = 4;
/** The two-sided chance of passing TREND_Z with no real change. */
export const TREND_CHANCE = 0.0000633;
/** ...and only when the share moves by at least this much. */
export const MIN_CHANGE = 0.05;

/** Purchases of one item among one copy's games. */
export interface Count {
  bought: number;
  games: number;
  /** True when the item was under SHARE_MIN in that copy, so `bought` is the most it could have been. */
  atMost?: true;
}

/** One item's share in the older and the newer copy. */
export interface ItemTrend {
  hero: number;
  position: number;
  item: number;
  older: Count;
  newer: Count;
  z: number;
}

/** What a comparison found, and how much of the data it could compare. */
export interface TrendResult {
  trends: ItemTrend[];
  /** Hero and positions compared, and those skipped for too few games or no counts in one copy. */
  compared: number;
  tooFew: number;
  noCounts: number;
  /** Item checks made, for the count of flags chance alone gives (checks * TREND_CHANCE). */
  checks: number;
}

/** itemTimings from one copy: hero, then position, then slice key. */
export type Timings = Record<string, Record<string, Record<string, ItemTimingSlice | undefined> | undefined> | undefined>;

function zScore(a: Count, b: Count): number {
  const p = (a.bought + b.bought) / (a.games + b.games);
  const se = Math.sqrt(p * (1 - p) * (1 / a.games + 1 / b.games));
  return se ? (b.bought / b.games - a.bought / a.games) / se : 0;
}

/**
 * Items whose share moved past TREND_Z and MIN_CHANGE between the two copies, biggest change first. An item
 * missing from one copy was bought in under SHARE_MIN of its games there: it is counted at that bound, the
 * case least likely to show a change, so a new item (Soul Ring from 1% to 10%) is still found.
 */
export function itemTrends(older: Timings, newer: Timings): TrendResult {
  const result: TrendResult = { trends: [], compared: 0, tooFew: 0, noCounts: 0, checks: 0 };
  for (const [hero, positions] of Object.entries(newer)) {
    for (const position of Object.keys(positions ?? {})) {
      const a = older[hero]?.[position]?.all;
      const b = newer[hero]?.[position]?.all;
      if (!a?.shares || !b?.shares) {
        result.noCounts++;
        continue;
      }
      if (a.games < MIN_GAMES || b.games < MIN_GAMES) {
        result.tooFew++;
        continue;
      }
      result.compared++;
      const then = new Map(a.shares);
      const now = new Map(b.shares);
      const bound = (games: number): Count => ({ bought: Math.floor(SHARE_MIN * games), games, atMost: true });
      for (const item of new Set([...then.keys(), ...now.keys()])) {
        const t = then.get(item);
        const n = now.get(item);
        const olderCount: Count = t === undefined ? bound(a.games) : { bought: t, games: a.games };
        const newerCount: Count = n === undefined ? bound(b.games) : { bought: n, games: b.games };
        result.checks++;
        const z = zScore(olderCount, newerCount);
        const change = newerCount.bought / newerCount.games - olderCount.bought / olderCount.games;
        if (Math.abs(z) >= TREND_Z && Math.abs(change) >= MIN_CHANGE) {
          result.trends.push({ hero: Number(hero), position: Number(position), item, older: olderCount, newer: newerCount, z });
        }
      }
    }
  }
  const change = (t: ItemTrend) => Math.abs(t.newer.bought / t.newer.games - t.older.bought / t.older.games);
  result.trends.sort((x, y) => change(y) - change(x));
  return result;
}
