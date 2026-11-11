/**
 * Which items players buy more or less often lately (Can, 2026-11-11: Soul Ring on Slark), from three daily
 * copies of the snapshot. STRATZ counts purchases from the patch start (ItemTimingSlice.shares), so the
 * difference between two copies is the games played in between: the older window runs from the first copy
 * to the second, the newer one from the second to the third. A drop in the counts means a new patch or a
 * STRATZ reset, and that hero and position is skipped.
 */
import type { ItemTimingSlice } from "./types";

/** Each window needs this many new games for a hero and position. */
export const MIN_WINDOW_GAMES = 1000;
/** A change is flagged past this z score... */
export const TREND_Z = 3;
/** ...and when the share moves by at least this much. */
export const MIN_CHANGE = 0.05;

/** One item's share among the games of each window. */
export interface ItemTrend {
  hero: number;
  position: number;
  item: number;
  older: { bought: number; games: number };
  newer: { bought: number; games: number };
  z: number;
}

/** itemTimings from one copy: hero, then position, then slice key. */
export type Timings = Record<string, Record<string, Record<string, ItemTimingSlice | undefined> | undefined> | undefined>;

const counts = (slice: ItemTimingSlice | undefined) => new Map(slice?.shares ?? []);

/** Items whose share changed between the two windows past TREND_Z and MIN_CHANGE, biggest change first. */
export function itemTrends(first: Timings, second: Timings, third: Timings): ItemTrend[] {
  const out: ItemTrend[] = [];
  for (const [hero, positions] of Object.entries(third)) {
    for (const position of Object.keys(positions ?? {})) {
      const [a, b, c] = [first, second, third].map((t) => t[hero]?.[position]?.all);
      if (!a?.shares || !b?.shares || !c?.shares) continue;
      const olderGames = b.games - a.games;
      const newerGames = c.games - b.games;
      if (olderGames < MIN_WINDOW_GAMES || newerGames < MIN_WINDOW_GAMES) continue;
      const ca = counts(a);
      const cb = counts(b);
      const cc = counts(c);
      for (const [item, now] of cc) {
        // An item under SHARE_MIN in an older copy wasn't stored there; its count then is unknown, not 0.
        const then = ca.get(item);
        const mid = cb.get(item);
        if (then === undefined || mid === undefined) continue;
        const older = { bought: mid - then, games: olderGames };
        const newer = { bought: now - mid, games: newerGames };
        if (older.bought < 0 || newer.bought < 0) continue;
        const p = (older.bought + newer.bought) / (older.games + newer.games);
        const se = Math.sqrt(p * (1 - p) * (1 / older.games + 1 / newer.games));
        if (!se) continue;
        const change = newer.bought / newer.games - older.bought / older.games;
        const z = change / se;
        if (Math.abs(z) >= TREND_Z && Math.abs(change) >= MIN_CHANGE) {
          out.push({ hero: Number(hero), position: Number(position), item, older, newer, z });
        }
      }
    }
  }
  const change = (t: ItemTrend) => Math.abs(t.newer.bought / t.newer.games - t.older.bought / t.older.games);
  return out.sort((x, y) => change(y) - change(x));
}
